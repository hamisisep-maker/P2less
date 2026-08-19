import type { ParamSpec } from "./connector-engine";

// ─────────────────────────────────────────────────────────────────────────────
// Universal Platform roadmap Phase 6 (2026-08-19 plan, 2026-08-20 build) — see
// docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md. "A developer pastes/uploads
// an OpenAPI spec → P2Less proposes a draft Capability set → human validates
// before it goes live." This is the draft-proposing half — genuinely new
// capabilities never get created without a human reviewing/editing this
// output first (see createConnectorFromDraftAction in actions.ts).
//
// Deliberately PURE (no DB, no network) — `import type` for ParamSpec is
// erased at compile time, so this file carries none of connector-engine.ts's
// "server-only" runtime guard and is trivially unit-testable.
//
// Deliberately PASTE-ONLY, never a URL the server fetches on the admin's
// behalf — accepting an admin-supplied URL and having the server request it
// is a textbook SSRF vector (probing internal network addresses via a public
// form). The admin copies their spec's JSON text in directly.
//
// Deliberately does NOT try to guess resourceGrantKey/resourceParam (which
// grant type + which param authorizes a request) — the ORIGINAL manual
// connector-form.tsx only ever special-cased the literal string "studentId";
// guessing wrong here would silently create an under-authorized capability.
// Left null/empty for the human to set explicitly during review.
// ─────────────────────────────────────────────────────────────────────────────

export type DraftAction = {
  key: string;
  name: string;
  description: string;
  method: string;
  path: string;
  paramSchema: ParamSpec[];
  requiresConfirm: boolean;
  requiresStepUp: boolean;
  riskLevel: "low" | "medium" | "high";
};

export type OpenApiParseResult =
  | { ok: true; suggestedName: string; suggestedDescription: string; suggestedBaseUrl: string; actions: DraftAction[] }
  | { ok: false; error: string };

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function deriveRiskLevel(method: string): "low" | "medium" | "high" {
  return method === "GET" ? "low" : "medium";
}

function deriveKey(method: string, path: string, operationId?: string): string {
  if (operationId) return operationId.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
  const segments = path.split("/").filter((s) => s && !s.startsWith("{"));
  const tail = segments.slice(-2).join("_") || "resource";
  return `${method}_${tail}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

function paramsFromOperation(pathParams: OpenApiParam[], opParams: OpenApiParam[], requestBodySchema: OpenApiSchema | undefined): ParamSpec[] {
  const specs: ParamSpec[] = [];
  const seen = new Set<string>();
  for (const p of [...pathParams, ...opParams]) {
    if (!p?.name || seen.has(p.name)) continue;
    if (p.in !== "path" && p.in !== "query") continue;
    seen.add(p.name);
    specs.push({ name: p.name, in: p.in, required: p.in === "path" ? true : !!p.required, from: "entity", entity: p.name });
  }
  const props = requestBodySchema?.properties;
  if (props) {
    const required = new Set(requestBodySchema?.required ?? []);
    for (const name of Object.keys(props)) {
      if (seen.has(name)) continue;
      seen.add(name);
      specs.push({ name, in: "body", required: required.has(name), from: "entity", entity: name });
    }
  }
  return specs;
}

type OpenApiParam = { name: string; in: string; required?: boolean };
type OpenApiSchema = { properties?: Record<string, unknown>; required?: string[] };
type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParam[];
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }> };
};
type OpenApiDoc = {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; description?: string };
  servers?: { url?: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, OpenApiOperation> & { parameters?: OpenApiParam[] }>;
};

/** Parses pasted OpenAPI 3.x (and basic Swagger 2.0) JSON text into a draft
 *  capability set. Never throws — always returns a result, honest about
 *  what it couldn't understand rather than silently skipping it. */
export function parseOpenApiSpec(specText: string): OpenApiParseResult {
  let doc: OpenApiDoc;
  try {
    doc = JSON.parse(specText);
  } catch {
    return { ok: false, error: "That's not valid JSON. Paste the spec's raw JSON text (YAML specs aren't supported yet — export/convert to JSON first)." };
  }
  if (!doc || typeof doc !== "object" || !doc.paths || typeof doc.paths !== "object") {
    return { ok: false, error: "Doesn't look like an OpenAPI/Swagger document — no `paths` object found." };
  }
  if (!doc.openapi && !doc.swagger) {
    return { ok: false, error: "Missing `openapi` or `swagger` version field — is this really an OpenAPI/Swagger spec?" };
  }

  const suggestedBaseUrl = doc.servers?.[0]?.url || (doc.host ? `https://${doc.host}${doc.basePath ?? ""}` : "");
  const actions: DraftAction[] = [];

  for (const [path, item] of Object.entries(doc.paths)) {
    if (!item || typeof item !== "object") continue;
    const pathParams = Array.isArray(item.parameters) ? item.parameters : [];
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const methodUpper = method.toUpperCase();
      const requestBodySchema = op.requestBody?.content?.["application/json"]?.schema;
      const paramSchema = paramsFromOperation(pathParams, op.parameters ?? [], requestBodySchema);
      actions.push({
        key: deriveKey(methodUpper, path, op.operationId),
        name: op.summary || `${methodUpper} ${path}`,
        description: op.description ?? "",
        method: methodUpper,
        path,
        paramSchema,
        requiresConfirm: methodUpper !== "GET",
        requiresStepUp: false,
        riskLevel: deriveRiskLevel(methodUpper),
      });
    }
  }

  if (actions.length === 0) {
    return { ok: false, error: "No operations found under any path (checked GET/POST/PUT/PATCH/DELETE)." };
  }

  return {
    ok: true,
    suggestedName: doc.info?.title ?? "Imported system",
    suggestedDescription: doc.info?.description ?? "",
    suggestedBaseUrl,
    actions,
  };
}
