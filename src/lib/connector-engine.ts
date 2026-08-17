import "server-only";
import { db } from "./db";
import { decryptJSON } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Connector engine — the integration layer.
//
// Executes a configured ConnectorAction against an external system over real
// HTTP: injects the connector's credentials, applies a timeout + retries, and
// maps the raw response into tidy fields via the action's responseMapping.
//
// The engine NEVER receives free-form SQL or arbitrary URLs from the AI. It can
// only run actions an administrator configured. Credentials are decrypted here,
// used for the outbound call, and never returned or logged.
// ─────────────────────────────────────────────────────────────────────────────

export type ParamSpec = {
  name: string;
  in: "path" | "query" | "body";
  required?: boolean;
  from?: "entity" | "grant" | "const";
  entity?: string;
  const?: unknown;
};

export type AuthConfig =
  | { type: "none" }
  | { type: "api_key"; header: string; value: string }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "oauth2"; accessToken: string }
  | { type: "jwt"; token: string };

export type ExecuteResult =
  | { ok: true; data: Record<string, unknown>; raw: unknown; status: number; latencyMs: number }
  | { ok: false; error: string; code: "config" | "network" | "timeout" | "http" | "mapping"; status?: number; latencyMs: number };

/** Dot-path getter: getPath({a:{b:1}}, "a.b") === 1. Supports [i] indexes. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((acc, seg) => {
    if (acc == null) return undefined;
    const m = seg.match(/^(\w+)\[(\d+)\]$/);
    if (m) {
      const arr = (acc as Record<string, unknown>)[m[1]];
      return Array.isArray(arr) ? arr[Number(m[2])] : undefined;
    }
    return (acc as Record<string, unknown>)[seg];
  }, obj);
}

function applyMapping(raw: unknown, mapping?: Record<string, string> | null): Record<string, unknown> {
  if (!mapping) return { result: raw } as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [field, path] of Object.entries(mapping)) {
    out[field] = getPath(raw, path);
  }
  return out;
}

function fillPath(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(String(values[k] ?? "")));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute a connector action.
 * @param actionId  ConnectorAction id
 * @param params    Resolved parameter values (already permission-checked upstream)
 */
export async function executeAction(
  actionId: string,
  params: Record<string, unknown>,
): Promise<ExecuteResult> {
  const started = Date.now();
  const action = await db.connectorAction.findUnique({
    where: { id: actionId },
    include: { connector: true },
  });
  if (!action || !action.enabled) {
    return { ok: false, error: "Action not found or disabled", code: "config", latencyMs: Date.now() - started };
  }
  const connector = action.connector;
  if (connector.status !== "active") {
    return { ok: false, error: "Connector is disabled", code: "config", latencyMs: Date.now() - started };
  }

  const specs = (action.paramSchema as unknown as ParamSpec[]) ?? [];
  const query = new URLSearchParams();
  const body: Record<string, unknown> = {};
  const pathValues: Record<string, unknown> = {};

  for (const spec of specs) {
    const value = params[spec.name] ?? spec.const;
    if (spec.required && (value === undefined || value === null || value === "")) {
      return {
        ok: false,
        error: `Missing required parameter: ${spec.name}`,
        code: "config",
        latencyMs: Date.now() - started,
      };
    }
    if (value === undefined || value === null) continue;
    if (spec.in === "path") pathValues[spec.name] = value;
    else if (spec.in === "query") query.set(spec.name, String(value));
    else body[spec.name] = value;
  }

  // Build URL
  const base = connector.baseUrl.replace(/\/$/, "");
  const path = fillPath(action.path, pathValues);
  const qs = query.toString();
  const url = `${base}${path.startsWith("/") ? "" : "/"}${path}${qs ? `?${qs}` : ""}`;

  // Auth injection
  const headers: Record<string, string> = { Accept: "application/json" };
  const auth = decryptJSON<AuthConfig>(connector.authConfigEnc) ?? { type: "none" };
  switch (auth.type) {
    case "api_key":
      headers[auth.header] = auth.value;
      break;
    case "bearer":
    case "oauth2":
      headers["Authorization"] = `Bearer ${auth.type === "bearer" ? auth.token : auth.accessToken}`;
      break;
    case "jwt":
      headers["Authorization"] = `Bearer ${auth.token}`;
      break;
    case "basic":
      headers["Authorization"] =
        "Basic " + Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
      break;
  }

  const init: RequestInit = { method: action.method, headers };
  if (action.method !== "GET" && action.method !== "DELETE") {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  // Execute with retries
  const maxAttempts = Math.max(1, connector.maxRetries + 1);
  let lastErr: ExecuteResult | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, connector.timeoutMs);
      const latencyMs = Date.now() - started;
      if (!res.ok) {
        lastErr = {
          ok: false,
          error: `External system returned HTTP ${res.status}`,
          code: "http",
          status: res.status,
          latencyMs,
        };
        // 4xx are not retried (they won't self-heal); 5xx are.
        if (res.status < 500) break;
        continue;
      }
      let raw: unknown;
      try {
        raw = await res.json();
      } catch {
        return { ok: false, error: "External system returned invalid JSON", code: "mapping", status: res.status, latencyMs };
      }
      const data = applyMapping(raw, action.responseMapping as Record<string, string> | null);
      await markHealth(connector.id, true);
      return { ok: true, data, raw, status: res.status, latencyMs };
    } catch (e) {
      const latencyMs = Date.now() - started;
      const isAbort = e instanceof Error && e.name === "AbortError";
      lastErr = {
        ok: false,
        error: isAbort ? "External system timed out" : "Could not reach external system",
        code: isAbort ? "timeout" : "network",
        latencyMs,
      };
    }
  }
  await markHealth(action.connector.id, false);
  return lastErr ?? { ok: false, error: "Unknown connector error", code: "network", latencyMs: Date.now() - started };
}

async function markHealth(connectorId: string, ok: boolean): Promise<void> {
  try {
    await db.connector.update({
      where: { id: connectorId },
      data: { lastCheckAt: new Date(), lastOk: ok },
    });
  } catch {
    /* health update is best-effort */
  }
}
