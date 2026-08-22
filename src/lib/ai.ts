import "server-only";
import { db } from "./db";
import { matchIntent, type IntentAction, type IntentMatch } from "./intent-engine";
import { getAiTenantId } from "./ai-context";
import { getCurrentChannelLabel, currentChannelSupportsFiles } from "./tenant-context";
import { getSettingNumber } from "./platform-settings";
import { randomToken } from "./crypto";

// ─────────────────────────────────────────────────────────────────────────────
// AI layer — provider-agnostic (Claude / OpenAI / Gemini). It does three jobs:
//   1) understand()      — pick an ALLOWED action + entities from the user's words,
//                          USING recent conversation so references ("her fees",
//                          "and the other one") and topic switches resolve.
//   2) humanizeReply()   — rephrase the REAL connector result into a warm, natural
//                          human reply, in the flow of the conversation, strictly
//                          grounded (no invented facts).
//   3) smallTalk()       — respond kindly, in context, to off-topic chit-chat.
//
// Guardrails: the AI never reaches a system or invents data. For understanding it
// may only choose from configured actions (re-validated). For replies it only
// rephrases facts we already retrieved and hands it. It never reveals it is AI.
// Everything degrades gracefully to the deterministic engine / templates with no
// API key, so the platform always works offline.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "anthropic" | "openai" | "google" | "xai" | "groq" | "cerebras" | "openrouter";

/** A prior turn in this conversation, oldest→newest, so the AI has memory. */
export type ChatTurn = { role: "user" | "assistant"; text: string };

const PROVIDER_ENV_PREFIX: Record<Provider, string> = {
  anthropic: "ANTHROPIC", openai: "OPENAI", xai: "XAI",
  groq: "GROQ", cerebras: "CEREBRAS", openrouter: "OPENROUTER",
  google: "GEMINI", // Google's SDK/env convention here is GEMINI_*, not GOOGLE_*
};

/** Every configured key for a provider, in order — supports multiple accounts
 *  per provider (e.g. several free-tier Gemini keys) so one account hitting its
 *  daily quota doesn't take the whole provider down. `{PREFIX}_API_KEYS` holds
 *  a comma- or newline-separated list; `{PREFIX}_API_KEY` (singular, the
 *  original convention) still works as a one-key fallback so nothing already
 *  configured breaks. */
function getProviderKeys(p: Provider): string[] {
  const prefix = PROVIDER_ENV_PREFIX[p];
  const list = process.env[`${prefix}_API_KEYS`];
  if (list) {
    const keys = list.split(/[,\n]/).map((k) => k.trim()).filter(Boolean);
    if (keys.length > 0) return keys;
  }
  const single = process.env[`${prefix}_API_KEY`];
  return single ? [single] : [];
}

/** Last-6-chars label for logs/cooldown tracking — enough to tell multiple
 *  keys on the same provider apart without ever printing a real secret. */
function keyLabel(key: string): string {
  return key.length > 6 ? `…${key.slice(-6)}` : "…";
}

// A key that just failed (quota/billing/rate-limit) is skipped for a while
// rather than retried on every single subsequent message — these failures are
// typically daily-quota-scale, not transient, so hammering it again 2 seconds
// later just wastes latency. In-memory only (matches rate-limit.ts's own
// bucket pattern): resets on redeploy, which is fine, since a fresh key list
// deserves a fresh chance anyway.
const keyCooldowns = new Map<string, number>();
const KEY_COOLDOWN_MS = 5 * 60_000;

function isCoolingDown(id: string): boolean {
  const until = keyCooldowns.get(id);
  return until != null && until > Date.now();
}

function markKeyFailed(id: string): void {
  keyCooldowns.set(id, Date.now() + KEY_COOLDOWN_MS);
}

function markKeyOk(id: string): void {
  keyCooldowns.delete(id);
}

/** Which providers actually have at least one usable (not-in-cooldown) key. */
function hasKey(p: Provider): boolean {
  return getProviderKeys(p).length > 0;
}

export type KeyHealth = { label: string; coolingDown: boolean; cooldownUntil: number | null };

/** Read-only snapshot for the /admin/ai key-health panel — never the real
 *  keys, just enough to see at a glance which of a provider's configured
 *  keys are live vs. resting off a recent quota/billing failure. Reads the
 *  same in-memory cooldown state callLLM()'s rotation actually uses, so this
 *  reflects reality, not a guess. Resets on redeploy, same as the cooldowns
 *  themselves — a freshly deployed instance shows every key as live until
 *  it's actually tried and fails. */
export function getKeyHealth(p: Provider): KeyHealth[] {
  return getProviderKeys(p).map((k) => {
    const label = keyLabel(k);
    const until = keyCooldowns.get(`${p}:${label}`) ?? null;
    return { label, coolingDown: until != null && until > Date.now(), cooldownUntil: until };
  });
}

/** The ORDERED list of providers to try: the configured primary first, then any
 *  other providers that have a key, as automatic failover. So if the primary is
 *  throttled/down (e.g. free-tier Gemini 429/503, or a paid key with zero credit
 *  balance), the reply still goes out via a backup key instead of falling to a
 *  canned template. Groq/Cerebras listed early — genuinely free tiers with much
 *  higher rate limits than Gemini's free tier, so they're worth trying before
 *  burning retries on a provider more likely to already be exhausted.
 *
 *  Primary is resolved in this order: a runtime override the super admin set
 *  at /admin/ai (PlatformSetting "ai_primary_provider", no redeploy needed) →
 *  the AI_PROVIDER env var → auto-detect from whichever key is configured. */
async function providerChain(): Promise<Provider[]> {
  const all: Provider[] = ["google", "groq", "cerebras", "openrouter", "anthropic", "openai", "xai"];
  let dbOverride = "";
  // A provider an admin disabled at /admin/integrations is skipped from the
  // chain entirely — a real functional gate, not just a display toggle.
  let disabled = new Set<string>();
  try {
    const [row, rows] = await Promise.all([
      db.platformSetting.findUnique({ where: { key: "ai_primary_provider" } }),
      db.integration.findMany({ where: { key: { startsWith: "ai_" }, enabled: false }, select: { key: true } }),
    ]);
    dbOverride = row?.value ?? "";
    disabled = new Set(rows.map((r) => r.key.replace("ai_", "")));
  } catch {
    // Table not migrated yet / DB hiccup — fall through to env, never block a reply on this.
  }
  const configured = (dbOverride || process.env.AI_PROVIDER || "").toLowerCase();
  const usable = (p: Provider) => hasKey(p) && !disabled.has(p);
  const primary = all.find((p) => p === configured && usable(p))
    ?? all.find(usable); // auto-detect if unset/keyless/disabled
  const chain: Provider[] = [];
  if (primary) chain.push(primary);
  for (const p of all) if (usable(p) && !chain.includes(p)) chain.push(p);
  return chain;
}

export function aiEnabled(): boolean {
  return (Object.keys(PROVIDER_ENV_PREFIX) as Provider[]).some(hasKey);
}

/** General-purpose completion for super-app TOOLS (data analysis, doc summary,
 *  rewrite…). Goes through the same retry + provider-failover chain, so tools get
 *  the same reliability as the chat layer. Returns text or null. */
export async function complete(system: string, user: string, maxTokens = 900, temperature = 0.3): Promise<string | null> {
  if (!aiEnabled()) return null;
  return callLLM(system, user, { maxTokens, temperature, feature: "tool_complete" });
}

/** Transcribe a WhatsApp voice note to text (Gemini is multimodal). Returns the
 *  spoken text in its original language, or null if we can't understand it. Lets
 *  users TALK to the assistant, not just type. Needs a Gemini key + audio-capable
 *  model (lite models may not accept audio, so use a full flash model for STT). */
export async function transcribeAudio(base64: string, mimeType: string): Promise<string | null> {
  const keys = getProviderKeys("google");
  if (keys.length === 0) return null;
  const model = process.env.GEMINI_STT_MODEL || "gemini-flash-latest";
  // Same multi-key rotation as callOnce's google branch: skip keys already in
  // cooldown from a recent failure, try the rest in order (bounded by however
  // many keys are actually configured — no point trying more than that).
  const ordered = [...keys].sort((a, b) => Number(isCoolingDown(`google:${keyLabel(a)}`)) - Number(isCoolingDown(`google:${keyLabel(b)}`)));
  for (const key of ordered) {
    const id = `google:${keyLabel(key)}`;
    try {
      const res = await fetchT(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { text: "Transcribe this voice message verbatim into text, in the SAME language that is spoken. Output ONLY the transcription — no quotes, no commentary. If nothing intelligible is said, output nothing." },
              { inlineData: { mimeType: mimeType || "audio/ogg", data: base64 } },
            ] }],
            generationConfig: { maxOutputTokens: 500, temperature: 0 },
          }),
        },
        20_000, // audio can take longer than a text turn
      );
      if (!res || !res.ok) {
        if (res) console.error(`[ai:google:stt] key=${id} status=${res.status} body=${(await res.text()).slice(0, 300)}`);
        markKeyFailed(id);
        continue;
      }
      markKeyOk(id);
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      recordAiCost("google", model, "transcribe_audio", j.usageMetadata ? { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount } : null);
      const text = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      return text && text.length > 0 ? text : null;
    } catch {
      markKeyFailed(id);
    }
  }
  return null;
}

type LLMOpts = { maxTokens?: number; temperature?: number; history?: ChatTurn[]; feature?: string };

/** Real per-request AI cost ledger (AiRequestLog) — looks up whichever
 *  ModelPricing row was actually in effect for this provider/model at call
 *  time (so a later price change never rewrites history), converts to KES,
 *  and records what this request is worth in billing terms (price_ai_kes)
 *  alongside it. Fire-and-forget: never awaited by the caller, never allowed
 *  to fail or slow down a real reply. Cost is 0 (not guessed) when nobody
 *  has configured pricing for this model yet — same "honest zero" convention
 *  as AiProviderConfig.costPerCallKes. */
function recordAiCost(provider: Provider, model: string, feature: string, usage: { input?: number; output?: number } | null, requestId?: string) {
  (async () => {
    const tenantId = getAiTenantId() ?? null;
    const inputTokens = usage?.input ?? null;
    const outputTokens = usage?.output ?? null;
    const totalTokens = inputTokens != null && outputTokens != null ? inputTokens + outputTokens : null;

    const [pricing, fxRate, revenueKesPerRequest] = await Promise.all([
      db.modelPricing.findFirst({ where: { provider, model, effectiveFrom: { lte: new Date() } }, orderBy: { effectiveFrom: "desc" } }),
      getSettingNumber("usd_to_kes_rate"),
      getSettingNumber("price_ai_kes"),
    ]);

    let costUsd = 0;
    if (pricing && inputTokens != null && outputTokens != null) {
      costUsd = (inputTokens / 1_000_000) * pricing.inputPerMillionUsd + (outputTokens / 1_000_000) * pricing.outputPerMillionUsd;
    }
    const costKes = costUsd * fxRate;

    await db.aiRequestLog.create({
      data: {
        tenantId, provider, model, feature, requestId,
        inputTokens, outputTokens, totalTokens,
        costUsd, costKes, revenueKes: revenueKesPerRequest,
        success: true,
      },
    });
  })().catch(() => {});
}

/** Pulls remaining/limit rate-limit numbers from whichever header shape this
 *  provider happens to use (OpenAI-compatible providers and Anthropic both
 *  return these; Gemini doesn't, so google calls just track call counts). */
function extractRateLimit(res: Response): { remaining?: number; limit?: number } {
  const remaining = res.headers.get("x-ratelimit-remaining-requests") ?? res.headers.get("anthropic-ratelimit-requests-remaining");
  const limit = res.headers.get("x-ratelimit-limit-requests") ?? res.headers.get("anthropic-ratelimit-requests-limit");
  const out: { remaining?: number; limit?: number } = {};
  if (remaining != null && !Number.isNaN(Number(remaining))) out.remaining = Number(remaining);
  if (limit != null && !Number.isNaN(Number(limit))) out.limit = Number(limit);
  return out;
}

/** Fire-and-forget daily counter per provider — so the super admin can see
 *  which providers are actually being used/failing without reading server
 *  logs. Never awaited by the caller and never allowed to fail a real reply. */
function recordAiStat(provider: Provider, ok: boolean, status?: number, errorSnippet?: string, rateLimit?: { remaining?: number; limit?: number }) {
  const date = new Date().toISOString().slice(0, 10);
  db.aiProviderStat
    .upsert({
      where: { provider_date: { provider, date } },
      create: {
        provider, date, calls: 1, successes: ok ? 1 : 0, failures: ok ? 0 : 1,
        lastStatus: status, lastError: ok ? null : (errorSnippet ?? "unknown error"),
        rateLimitRemaining: rateLimit?.remaining, rateLimitLimit: rateLimit?.limit,
      },
      update: {
        calls: { increment: 1 }, successes: { increment: ok ? 1 : 0 }, failures: { increment: ok ? 0 : 1 },
        lastStatus: status, lastError: ok ? null : (errorSnippet ?? "unknown error"),
        ...(rateLimit?.remaining != null ? { rateLimitRemaining: rateLimit.remaining } : {}),
        ...(rateLimit?.limit != null ? { rateLimitLimit: rateLimit.limit } : {}),
      },
    })
    .catch(() => {});
}

// ── Priority 4: per-attempt event stream + audited failover ─────────────────
// Correlates every attempt within ONE callLLM() invocation (across retries
// AND provider failover) so "primary failed, fallback activated" is a real,
// traceable fact — not inferable only by eyeballing two providers' daily
// counters on the same day. Does not replace recordAiStat/recordAiCost
// (still called exactly as before); this is additive telemetry only, never
// allowed to affect which branch executes or slow down a real reply.
type AttemptTrack = { correlationId: string; providerRank: number; attemptNumber: number; tenantId: string | null };

function recordAiCallEvent(track: AttemptTrack, provider: Provider, model: string, feature: string, ok: boolean, info: { statusCode?: number; errorSnippet?: string; latencyMs: number; requestId?: string }) {
  db.aiCallEvent.create({
    data: {
      correlationId: track.correlationId, tenantId: track.tenantId, provider, model, feature,
      providerRank: track.providerRank, attemptNumber: track.attemptNumber, ok,
      statusCode: info.statusCode, errorSnippet: info.errorSnippet?.slice(0, 500), latencyMs: info.latencyMs, requestId: info.requestId,
    },
  }).catch(() => {});
}

/** Writes to the tenant's own audit trail (via audit.ts, same writer every
 *  other privileged/system event uses) — "Primary model unavailable,
 *  fallback activated" becomes a real, queryable audit row, not just an
 *  inference from two separate counters. Skipped when no tenant is known yet
 *  (e.g. voice-note transcription before routing) since AuditLog requires one. */
function aiFailoverAudit(tenantId: string | null, detail: Record<string, unknown>) {
  if (!tenantId) return;
  (async () => {
    const { audit } = await import("./audit");
    const { requestId: newRequestId } = await import("./crypto");
    await audit({ tenantId, requestId: newRequestId(), actorType: "system", action: "ai.provider_failover", success: true, detail });
  })().catch(() => {});
}

// A hung or slow model must NEVER hold up the user's reply — on a real channel
// that means no WhatsApp message arrives at all. Any call that exceeds this
// budget is aborted and the caller falls back to the deterministic template.
const LLM_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 9000);

/** fetch() with a hard abort timeout. Returns null on timeout/abort. */
async function fetchT(url: string, init: RequestInit, timeoutMs = LLM_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Completion with retries AND provider failover. Each provider in the chain is
 *  tried a couple of times (transient 429/503/timeout backoff); if it still fails,
 *  we fall over to the next configured provider before giving up to the
 *  deterministic template. A single throttled key no longer silences the reply. */
async function callLLM(system: string, user: string, opts: LLMOpts = {}): Promise<string | null> {
  const chain = await providerChain();
  const perProvider = Number(process.env.AI_ATTEMPTS || 2);
  const correlationId = randomToken(6);
  const tenantId = getAiTenantId() ?? null;
  for (let rank = 0; rank < chain.length; rank++) {
    const p = chain[rank];
    const keys = getProviderKeys(p);
    if (keys.length === 0) continue;
    // Multiple accounts/keys per provider rotate here: keys not currently in a
    // cooldown (from a recent quota/billing failure — see markKeyFailed) go
    // first, so a provider with e.g. 20 Gemini keys and 3 already-exhausted
    // ones tries the 17 live ones before ever touching the dead 3 again.
    const ordered = [...keys].sort((a, b) => Number(isCoolingDown(`${p}:${keyLabel(a)}`)) - Number(isCoolingDown(`${p}:${keyLabel(b)}`)));
    // At least one attempt per configured key (so a big key pool actually
    // gets exhausted before failing over to the next provider), but never
    // fewer than AI_ATTEMPTS even with just one key — preserves the original
    // same-key retry behavior when only a single key is configured.
    const attempts = Math.max(perProvider, ordered.length);
    for (let i = 0; i < attempts; i++) {
      const key = ordered[i % ordered.length];
      // Only pause between attempts when actually retrying the SAME key again
      // (cycling back around a small pool) — different keys are different
      // credentials/quota buckets, no reason to throttle switching to one.
      if (i > 0 && key === ordered[(i - 1) % ordered.length]) await new Promise((r) => setTimeout(r, 300));
      const out = await callOnce(p, key, system, user, opts, { correlationId, providerRank: rank, attemptNumber: i, tenantId });
      if (out) {
        // Succeeded, but NOT on the primary provider (rank 0) — this is a
        // real, audited failover, and the successful request's cost still
        // lands in AiRequestLog exactly as it would for the primary (recordAiCost
        // was already called inside callOnce on the same success path).
        if (rank > 0) {
          aiFailoverAudit(tenantId, {
            primaryProvider: chain[0], fallbackProvider: p, providerRank: rank,
            feature: opts.feature ?? "unknown", reason: "primary provider unavailable", correlationId,
          });
        }
        return out;
      }
    }
    // Every configured key for this provider failed → fall over to the next configured provider.
  }
  if (chain.length > 0) {
    aiFailoverAudit(tenantId, { primaryProvider: chain[0], fallbackProvider: null, feature: opts.feature ?? "unknown", reason: "all configured providers failed", correlationId });
  }
  return null;
}

/** Single completion attempt against ONE provider using ONE specific key (the
 *  caller in callLLM already picked which key out of that provider's pool),
 *  with optional multi-turn history. */
async function callOnce(p: Provider, apiKey: string, system: string, user: string, opts: LLMOpts = {}, track?: AttemptTrack): Promise<string | null> {
  const { maxTokens = 300, temperature = 0.4 } = opts;
  const attemptStartedAt = Date.now();
  const keyId = `${p}:${keyLabel(apiKey)}`;
  // Gemini and Anthropic REQUIRE the first turn to be a user turn. Our history is
  // a raw slice of recent messages, so it may start with an assistant reply —
  // passing that verbatim makes the whole call 400 and the AI silently falls back.
  // Drop any leading assistant turns so history always starts with a user turn.
  let history = opts.history ?? [];
  while (history.length && history[0].role === "assistant") history = history.slice(1);
  try {
    // OpenAI, xAI (Grok), Groq, Cerebras, and OpenRouter all share the same
    // "OpenAI-compatible" Chat Completions request shape — only the base URL
    // and default model differ, so one lookup table covers all five instead
    // of repeating the request logic per provider. The key is whichever one
    // callLLM picked for this attempt, not read from env here.
    const OPENAI_COMPAT: Partial<Record<Provider, { url: string; model: string }>> = {
      openai: { url: "https://api.openai.com/v1/chat/completions", model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
      xai: { url: "https://api.x.ai/v1/chat/completions", model: process.env.XAI_MODEL || "grok-4" },
      // Free tier, generous rate limits, fast inference. Verified working
      // 2026-08-19 — catalog changes over time; if this 404s, check
      // console.groq.com or GET /openai/v1/models with your key.
      groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: process.env.GROQ_MODEL || "openai/gpt-oss-120b" },
      cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", model: process.env.CEREBRAS_MODEL || "gpt-oss-120b" },
      // Free-tier models carry a ":free" suffix and share upstream capacity
      // across ALL OpenRouter free users, so they're prone to 429s at busy
      // times (confirmed 2026-08-19) — treat as a bonus, not primary. Catalog
      // changes often; check openrouter.ai/models?max_price=0 if this 404s.
      openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: process.env.OPENROUTER_MODEL || "google/gemma-4-31b-it:free" },
    };
    const compat = OPENAI_COMPAT[p];
    if (compat) {
      const res = await fetchT(compat.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: compat.model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: "system", content: system },
            ...history.map((t) => ({ role: t.role, content: t.text })),
            { role: "user", content: user },
          ],
        }),
      });
      if (!res || !res.ok) {
        const body = res ? (await res.text()).slice(0, 300) : "no response";
        console.error(`[ai:${p}] key=${keyId} status=${res?.status} body=${body}`);
        markKeyFailed(keyId);
        recordAiStat(p, false, res?.status, body);
        if (track) recordAiCallEvent(track, p, compat.model, opts.feature ?? "unknown", false, { statusCode: res?.status, errorSnippet: body, latencyMs: Date.now() - attemptStartedAt });
        return null;
      }
      markKeyOk(keyId);
      recordAiStat(p, true, res.status, undefined, extractRateLimit(res));
      const j = (await res.json()) as { id?: string; choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      recordAiCost(p, compat.model, opts.feature ?? "unknown", j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : null, j.id);
      if (track) recordAiCallEvent(track, p, compat.model, opts.feature ?? "unknown", true, { statusCode: res.status, latencyMs: Date.now() - attemptStartedAt, requestId: j.id });
      return j.choices?.[0]?.message?.content?.trim() ?? null;
    }
    if (p === "google") {
      const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
      // Full "thinking" flash models (e.g. gemini-3.x-flash) burn the output-token
      // budget on hidden reasoning and truncate the visible reply, so we turn it
      // off. But the fast "lite" models don't support thinkingConfig at all (400),
      // and don't need it — so only send it to non-lite models.
      const genCfg: Record<string, unknown> = { maxOutputTokens: maxTokens, temperature };
      if (!/lite/i.test(model)) genCfg.thinkingConfig = { thinkingBudget: 0 };
      const res = await fetchT(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [
            ...history.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.text }] })),
            { role: "user", parts: [{ text: user }] },
          ],
          generationConfig: genCfg,
        }),
      });
      if (!res || !res.ok) {
        const body = res ? (await res.text()).slice(0, 300) : "no response";
        console.error(`[ai:${p}] key=${keyId} status=${res?.status} body=${body}`);
        markKeyFailed(keyId);
        recordAiStat(p, false, res?.status, body);
        if (track) recordAiCallEvent(track, p, model, opts.feature ?? "unknown", false, { statusCode: res?.status, errorSnippet: body, latencyMs: Date.now() - attemptStartedAt });
        return null;
      }
      markKeyOk(keyId);
      recordAiStat(p, true, res.status);
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } };
      recordAiCost(p, model, opts.feature ?? "unknown", j.usageMetadata ? { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount } : null);
      if (track) recordAiCallEvent(track, p, model, opts.feature ?? "unknown", true, { statusCode: res.status, latencyMs: Date.now() - attemptStartedAt });
      return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    }
    if (p === "anthropic") {
      const res = await fetchT("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
          max_tokens: maxTokens,
          temperature,
          system,
          messages: [
            ...history.map((t) => ({ role: t.role, content: t.text })),
            { role: "user", content: user },
          ],
        }),
      });
      if (!res || !res.ok) {
        const body = res ? (await res.text()).slice(0, 300) : "no response";
        console.error(`[ai:${p}] key=${keyId} status=${res?.status} body=${body}`);
        markKeyFailed(keyId);
        recordAiStat(p, false, res?.status, body);
        if (track) recordAiCallEvent(track, p, process.env.ANTHROPIC_MODEL || "claude-sonnet-5", opts.feature ?? "unknown", false, { statusCode: res?.status, errorSnippet: body, latencyMs: Date.now() - attemptStartedAt });
        return null;
      }
      markKeyOk(keyId);
      recordAiStat(p, true, res.status, undefined, extractRateLimit(res));
      const j = (await res.json()) as { id?: string; content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
      recordAiCost(p, process.env.ANTHROPIC_MODEL || "claude-sonnet-5", opts.feature ?? "unknown", j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : null, j.id);
      if (track) recordAiCallEvent(track, p, process.env.ANTHROPIC_MODEL || "claude-sonnet-5", opts.feature ?? "unknown", true, { statusCode: res.status, latencyMs: Date.now() - attemptStartedAt, requestId: j.id });
      return j.content?.[0]?.text?.trim() ?? null;
    }
  } catch (e) {
    const errorSnippet = e instanceof Error ? e.message.slice(0, 200) : "unknown exception";
    markKeyFailed(keyId);
    recordAiStat(p, false, undefined, errorSnippet);
    if (track) recordAiCallEvent(track, p, "unknown", opts.feature ?? "unknown", false, { errorSnippet, latencyMs: Date.now() - attemptStartedAt });
    return null;
  }
  return null;
}

// The org's local timezone for dates/times the assistant reasons about. Defaults
// to East Africa (these are Kenyan orgs); override with APP_TIMEZONE.
const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";

/** morning | afternoon | evening | night, in the org's local timezone. */
export function partOfDay(): string {
  try {
    const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: TZ }));
    return h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
  } catch {
    return "day";
  }
}

/** A friendly, human-readable "now" the AI can reason about — date, local clock
 *  time and part of day — so it can tell the time and greet appropriately. */
export function nowStr(): string {
  try {
    const d = new Date();
    const date = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ });
    return `${date}, ${time} (${partOfDay()}), local time in ${TZ}`;
  } catch {
    return new Date().toISOString();
  }
}

// Lightweight EN/SW detector so we can give the model an EXPLICIT language to
// reply in, instead of hoping it infers it (it tends to drift to the language of
// recent history). Counts distinctive frequent words in each language; the higher
// count wins. Returns null for too-short/ambiguous/mixed input (let the model
// decide from the message itself). Good enough for the common English↔Swahili case.
const SW_WORDS = /\b(ni|na|ya|wa|kwa|la|za|cha|vya|kwenye|kuhusu|nataka|ninahitaji|naomba|tafadhali|asante|karibu|habari|mambo|sasa|pole|poleni|samahani|salio|ada|deni|mtoto|wangu|wako|mwalimu|shule|tarehe|lini|nini|vipi|leo|kesho|jana|ndio|ndiyo|hapana|mwanafunzi|mahudhurio|matokeo|miadi|lipa|hodi|jambo|nzuri|sawa|niambie|onyesha|angalia)\b/gi;
const EN_WORDS = /\b(the|is|are|was|my|your|what|when|where|how|why|please|need|want|show|tell|give|me|a|an|of|to|for|and|you|i|do|does|can|could|would|will|this|that|it|more|about|everything|general|overview|balance|fee|fees|child|school|today|tomorrow|yes|no|thanks|thank|hello|hi|results|attendance|appointment|arrived|owe)\b/gi;
function detectLang(text: string): "English" | "Swahili" | null {
  const sw = (text.match(SW_WORDS) ?? []).length;
  const en = (text.match(EN_WORDS) ?? []).length;
  if (sw === 0 && en === 0) return null;
  if (sw > en) return "Swahili";
  if (en > sw) return "English";
  return null; // tie → ambiguous/mixed
}

/** Today's calendar date (YYYY-MM-DD) in the org timezone. */
function todayISO(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // en-CA → YYYY-MM-DD
}

/** Whole days from today to an ISO date (positive = future, negative = past). */
function daysFromToday(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayISO());
  if (!m || !t) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = Date.UTC(+t[1], +t[2] - 1, +t[3]);
  return Math.round((target - today) / 86_400_000);
}

/** Precompute how far each date in the facts is from today, so the AI can answer
 *  "how many days until…" ACCURATELY (deterministic math, not model arithmetic). */
function dateHints(factText: string): string {
  const seen = new Set<string>();
  const hints: string[] = [];
  for (const iso of factText.match(/\d{4}-\d{2}-\d{2}/g) ?? []) {
    if (seen.has(iso)) continue;
    seen.add(iso);
    const d = daysFromToday(iso);
    if (d === null) continue;
    const rel =
      d === 0 ? "that is TODAY" :
      d === 1 ? "that is TOMORROW (1 day from today)" :
      d === -1 ? "that was YESTERDAY (1 day ago)" :
      d > 1 ? `that is ${d} days from today` :
      `that was ${-d} days ago`;
    hints.push(`- ${iso}: ${rel}.`);
  }
  return hints.length ? `\n\nTEMPORAL CONTEXT (today is ${todayISO()} — use ONLY if the user asks about timing/how many days; these are exact, trust them):\n${hints.join("\n")}` : "";
}

/** An explicit language instruction for reply prompts, based on THIS message. */
function langDirective(text: string): string {
  const lang = detectLang(text);
  return lang
    ? `Reply ONLY in ${lang}. The user's current message is in ${lang}, so your entire reply must be in ${lang}.`
    : `Reply in the SAME language as the user's current message (English → English, Swahili → Swahili, Sheng/mixed → mirror it).`;
}

/** Render recent history as a compact transcript for prompts that need it inline. */
function transcript(history: ChatTurn[], max = 8): string {
  return history
    .slice(-max)
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`)
    .join("\n");
}

// ── 1) Intent understanding (controlled tools, context-aware) ───────────────
export async function understand(text: string, actions: IntentAction[], history: ChatTurn[] = []): Promise<IntentMatch & { via: "ai" | "local" }> {
  if (!aiEnabled()) return { ...matchIntent(text, actions), via: "local" };
  const allowed = actions.map((a) => a.key);
  const catalog = actions.map((a) => `- ${a.key}: ${a.name}${a.description ? ` — ${a.description}` : ""} (e.g. ${(a.samplePhrases ?? []).slice(0, 3).join("; ")})`).join("\n");
  const convo = history.length ? `RECENT CONVERSATION (use it to resolve references like "her", "that one", follow-ups like "and the fees?", and topic switches):\n${transcript(history)}\n\n` : "";
  const system = `You are an intent router for a WhatsApp assistant. Choose the single best action for what the user wants NOW, from the ALLOWED list, or "NONE" if nothing fits.
- Use the recent conversation to interpret short or referring messages (e.g. after talking about a student named Zawadi, "and her fees?" means the fee-balance action for Zawadi).
- ASKING vs DOING: if the user is asking for information about something that may already exist ("when is…", "what's…", "do I have…", "check…", "show…", "next appointment/meeting"), pick the matching LOOKUP/GET action — NOT a create/book/submit action. Only pick a create/book/schedule/submit/cancel action when the user clearly wants to make or change something ("book", "schedule", "request", "I want to create", "cancel").
- If the message is about something you have NO action for — staff/people like a driver, cook, headmaster, a teacher's name, bus routes, uniforms, directions, general trivia — return "NONE". NEVER map an unrelated question onto a student-data action (e.g. do not answer "who is the driver of the school?" with a fee balance). Pick an action ONLY when the message genuinely matches what that action does.
- META / ELIGIBILITY / small clarifying questions about the SERVICE itself are NOT data lookups → return "NONE". Examples: "parents only?", "is this only for parents?", "who can use this?", "what can you do?", "are you a bot?", "how does this work?". Do not trigger an action just because a keyword (like "parents") appears in such a question.
- TIMING / "HOW MANY DAYS" questions: "how many days until / how long until / how soon is / when is <event>" about an appointment or meeting → the NEXT-APPOINTMENT lookup; about a due date/payment → the FEE/BALANCE lookup. Route to whichever LOOKUP returns that event's DATE (do NOT pick attendance just because the word "days" appears).
- BROAD / VAGUE requests: if the message is a broad, open-ended, or summary-style request that does NOT clearly point to ONE specific action — e.g. "tell me about Zawadi", "give me an overview of everything about my child", "how is she doing", "everything about X", "general info" — return "NONE". Do NOT force it into a single action like fees or results. (The assistant will then offer the specific things it can show.) Only pick a specific action when the user clearly wants that ONE thing.
- Extract entities (a person's name — resolve pronouns from context; dates; times). Right now it is ${nowStr()} — resolve relative dates/times like "today", "tomorrow", "next Friday", "this evening" against it. Never invent an action not in the list.`;
  const user = `${convo}ALLOWED ACTIONS:\n${catalog}\n\nCurrent user message: ${JSON.stringify(text)}\n\nRespond with ONLY compact JSON: {"action":"<KEY or NONE>","confidence":0..1,"entities":{"name":"...","date":"...","time":"..."}}`;
  const raw = await callLLM(system, user, { maxTokens: 250, temperature: 0, feature: "understand" });
  if (raw) {
    try {
      const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { action: string; confidence?: number; entities?: Record<string, string> };
      if (parsed.action && parsed.action !== "NONE" && allowed.includes(parsed.action)) {
        const chosen = actions.find((a) => a.key === parsed.action)!;
        const score = Math.min(1, Math.max(0, parsed.confidence ?? 0.7));
        const entities = Object.fromEntries(Object.entries(parsed.entities ?? {}).filter(([, v]) => v != null && String(v).trim() !== "")) as Record<string, string>;
        return { actionId: chosen.id, actionKey: chosen.key, score, entities, candidates: [{ actionId: chosen.id, actionKey: chosen.key, score }], via: "ai" };
      }
      if (parsed.action === "NONE") {
        // The AI is confident nothing fits (e.g. a broad "tell me about X"). TRUST
        // it — only override with the deterministic engine on a VERY strong keyword
        // hit, so vague requests go to small talk instead of being forced into a
        // random action (that's what made "tell me more about X" ask for a date).
        const local = matchIntent(text, actions);
        if (local.actionId && local.score >= 0.85) return { ...local, via: "local" };
        return { actionId: null, actionKey: null, score: 0, entities: {}, candidates: [], via: "ai" };
      }
    } catch {
      /* fall through */
    }
  }
  return { ...matchIntent(text, actions), via: "local" };
}

// ── 1b) Commerce intent (typo/language-tolerant, grounded to the REAL catalog) ──
// Same discipline as understand(): the AI picks from a list it's given (real
// product ids only, never invented) and returns "none" when unsure rather than
// guessing. This exists because keyword regexes cannot handle typos ("procys"),
// alternate phrasing ("how much is X" ≠ an order), or non-English input
// (Swahili "bei gani", "nataka tano") — all real, reported failures.
export type CommerceIntent =
  | { kind: "browse" }
  | { kind: "order"; productId: string; quantity?: number; optionAnswer?: string }
  | { kind: "price_question"; productId?: string }
  | { kind: "image_question"; productId?: string }
  | { kind: "none" };

export async function classifyCommerceMessage(
  text: string,
  products: { id: string; name: string }[],
  history: ChatTurn[] = [],
): Promise<CommerceIntent> {
  if (!aiEnabled() || products.length === 0) return { kind: "none" };
  const catalog = products.map((p) => `- id="${p.id}": ${p.name}`).join("\n");
  const convo = history.length ? `RECENT CONVERSATION (use it to resolve short follow-ups — e.g. after discussing "the sweater", "blue, any size, five of them" answers THAT product):\n${transcript(history)}\n\n` : "";
  const system = `You are a shopping-intent classifier for a WhatsApp business assistant. The business sells EXACTLY these products — never invent, assume, or match a different one:
${catalog}

Classify the user's CURRENT message. Understand ANY language (English, Swahili, Sheng, mixed) and tolerate typos/shorthand — read for MEANING, not exact keywords.
- "browse": asking what's for sale in general, not about one specific product.
- "order": wants to buy/order a SPECIFIC product from the list. Extract quantity as a number if one was genuinely stated, in ANY language or word form ("tano"→5, "five"→5, "5"→5) — omit if not stated, never default to 1. If the message also answers a color/size/variant choice, put that free text in optionAnswer.
- "price_question": asking the price/cost/"how much"/"bei gani" for a product (a specific one if identifiable, else omit productId).
- "image_question": asking to see a photo/picture/image of a product.
- "none": anything else — a different question, small talk, unrelated topic. If genuinely unsure which of the above it is, choose "none" rather than guessing.

Respond with ONLY compact JSON: {"kind":"browse"|"order"|"price_question"|"image_question"|"none","productId":"<exact id from the list, or omit>","quantity":<number, or omit>,"optionAnswer":"<text, or omit>"}`;
  const raw = await callLLM(system, `${convo}Current message: ${JSON.stringify(text)}`, { maxTokens: 150, temperature: 0, feature: "commerce_classify" });
  if (!raw) return { kind: "none" };
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { kind?: string; productId?: string; quantity?: number; optionAnswer?: string };
    const validId = parsed.productId && products.some((p) => p.id === parsed.productId) ? parsed.productId : undefined;
    if (parsed.kind === "order" && validId) {
      return { kind: "order", productId: validId, quantity: typeof parsed.quantity === "number" && parsed.quantity > 0 ? Math.floor(parsed.quantity) : undefined, optionAnswer: parsed.optionAnswer || undefined };
    }
    if (parsed.kind === "price_question") return { kind: "price_question", productId: validId };
    if (parsed.kind === "image_question") return { kind: "image_question", productId: validId };
    if (parsed.kind === "browse") return { kind: "browse" };
    return { kind: "none" };
  } catch {
    return { kind: "none" };
  }
}

/** Interprets a free-form reply to ONE pending order question (quantity, a
 *  color/size choice, delivery-vs-pickup, or a delivery address) when the fast
 *  deterministic check didn't recognize it. Used so a state never just repeats
 *  its canned question verbatim when the customer said something real — asks
 *  something else, answers unclearly, or the wording just didn't match a
 *  regex. If they answered, extracts the value; if not, produces an honest,
 *  natural, non-repetitive reply (answering their real question if it can from
 *  what it actually knows) that still ends by restating what's needed. */
export async function resolveOrderStepAnswer(opts: {
  assistant: string;
  question: string; // what we're waiting for, in plain words, e.g. "how many they want" | "delivery or pickup" | "their delivery address" | "which color/size (Colors: Navy, Grey)"
  userText: string;
  knownFacts?: string;
  history?: ChatTurn[];
}): Promise<{ answered: true; value: string } | { answered: false; reply: string }> {
  if (!aiEnabled()) return { answered: false, reply: "" };
  const known = `\n\nWHAT YOU ACTUALLY KNOW ABOUT THIS PRODUCT (this is the COMPLETE list — nothing else about it is known, not even by inference):\n${opts.knownFacts || "(nothing beyond the name)"}`;
  const system = `You are a warm, sharp human staff member for ${opts.assistant} on WhatsApp, mid-way through taking an order. You are currently waiting for ONE specific thing: ${opts.question}.

The customer just replied. Two possibilities:
1. Their reply GENUINELY answers what you asked (even phrased oddly, in another language, or with a typo) — extract it.
2. They said something else — a real question, a comment, confusion, pushback — not an answer.

LANGUAGE: ${langDirective(opts.userText)}
CRITICAL RULE — DO NOT INVENT: if they ask about ANYTHING not explicitly listed under "WHAT YOU ACTUALLY KNOW" below (colors, sizes, materials, stock, brand, specs, delivery time, anything) — do NOT guess or make up a plausible-sounding answer, even one word of it. Say plainly that it's not something you have on file and you'll check with the team, THEN continue toward what you still need. Inventing details that don't exist is the single worst thing you can do here — a customer could pay for something based on a detail you made up. When in doubt, say you don't know.
Never just repeat a canned line — sound like a real person, vary your wording, a touch of warmth or light humor is welcome but keep it brief and helpful, then naturally circle back to what you still need.${known}

Respond with ONLY compact JSON:
{"answered": true, "value": "<the extracted answer, exactly as they'd want it recorded>"} — if case 1
{"answered": false, "reply": "<your natural reply text>"} — if case 2`;
  const raw = await callLLM(system, `Customer said: ${JSON.stringify(opts.userText)}`, { maxTokens: 200, temperature: 0.6, history: opts.history, feature: "order_step" });
  if (!raw) return { answered: false, reply: "" };
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { answered?: boolean; value?: string; reply?: string };
    if (parsed.answered && parsed.value) return { answered: true, value: String(parsed.value) };
    if (parsed.reply) return { answered: false, reply: String(parsed.reply) };
    return { answered: false, reply: "" };
  } catch {
    return { answered: false, reply: "" };
  }
}

// Universal Platform roadmap Phase 8e (2026-08-21) — website content
// ingestion. Extracts a candidate FAQ draft from real, already-fetched page
// text (fetching/crawling itself lives in website-crawl.ts, kept separate
// from this AI call, same "engine does the work, AI only rephrases/extracts
// from what's already retrieved" discipline as everywhere else in this
// file). Deliberately grounded-only — never invents a fact not present in
// the supplied text — and the caller (the dashboard action) NEVER saves this
// straight to Tenant.faqs; it's always a draft a human reviews first.
export async function extractFaqDraft(orgName: string, pages: { url: string; text: string }[]): Promise<{ q: string; a: string }[]> {
  if (!aiEnabled() || pages.length === 0) return [];
  const combined = pages.map((p) => `--- ${p.url} ---\n${p.text}`).join("\n\n").slice(0, 15000);
  const system = `You are extracting a candidate FAQ list for ${orgName}'s WhatsApp/website assistant, from real content scraped off their own public website.

Read the page content below and produce Q&A pairs a real visitor might plausibly ask, ONLY where the answer is explicitly stated in the content — never invent, infer, or embellish a fact that isn't literally there. Skip anything not clearly answerable from the text (navigation labels, marketing fluff with no real fact, anything ambiguous). Prefer practical, commonly-asked things: hours, location, contact details, admission/enrollment requirements, fees mentioned, programs/services offered, policies.

Keep each answer SHORT and factual — one or two sentences, in the org's own wording where possible, no invented flourishes.

Respond with ONLY a compact JSON array: [{"q":"<question>","a":"<answer>"}, ...] — an EMPTY array [] if nothing on the page is clearly FAQ-worthy. Never pad with low-value or invented entries just to have something to show.`;
  const raw = await callLLM(system, `WEBSITE CONTENT:\n${combined}`, { maxTokens: 1200, temperature: 0.2, feature: "faq_extraction" });
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw.slice(raw.indexOf("["), raw.lastIndexOf("]") + 1)) as { q?: string; a?: string }[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f) => ({ q: String(f.q ?? "").trim(), a: String(f.a ?? "").trim() })).filter((f) => f.q && f.a).slice(0, 30);
  } catch {
    return [];
  }
}

// ── 2) Human-like reply (grounded rephrase — no hallucination, in flow) ─────
export async function humanizeReply(orgName: string, userText: string, factText: string, history: ChatTurn[] = []): Promise<string> {
  if (!aiEnabled() || !factText) return factText;
  const system = `You are the friendly WhatsApp assistant for ${orgName}, talking one-to-one with someone you're already in a conversation with. Rewrite the ANSWER as a warm, natural, human-sounding reply that fits the flow of the chat.
STRICT RULES:
- LANGUAGE (important): ${langDirective(userText)} EVEN IF earlier messages in the history were in a different language. Do not switch languages on your own.
- Keep every number, amount, currency, date, time, reference and name EXACTLY as given in the ANSWER (translate the wording around them if needed, but never change a digit, name or date).
- Do NOT add, guess, or invent any fact that is not in the ANSWER. EXCEPTION: if the user asks about timing ("how many days until…", "is that soon", "what day is that"), you MAY use the TEMPORAL CONTEXT below to tell them how many days away a date is — those figures are pre-calculated and exact. Still keep the original date too.
- Do NOT say you are a bot, an AI, an assistant program, or automated. Sound like a helpful person.
- If it's a follow-up (e.g. "and her fees?"), answer naturally as a continuation, not as a fresh greeting.
- Keep it concise and WhatsApp-appropriate (usually 1–3 short sentences). A tasteful emoji is fine.
Reply with ONLY the message text — no preamble.`;
  const user = `The user just asked (reply in THIS message's language): ${JSON.stringify(userText)}\n\nANSWER to convey (keep all facts — numbers, dates, names — exactly): ${JSON.stringify(factText)}${dateHints(factText)}`;
  const out = await callLLM(system, user, { maxTokens: 220, temperature: 0.5, history, feature: "humanize_reply" });
  return out && out.length > 1 ? out : factText;
}

// ── 3) Small talk / general conversation (human, grounded) ──────────────────
export type Faq = { q: string; a: string };

export async function smallTalk(orgName: string, userText: string, capabilities: string[], history: ChatTurn[] = [], knownFacts = "", faqs: Faq[] = []): Promise<string | null> {
  if (!aiEnabled()) return null;
  const known = knownFacts ? `\n\nWHAT YOU ALREADY KNOW (authorized — you MAY share these if asked):\n${knownFacts}` : "";
  const faqBlock = faqs.length
    ? `\n\nAPPROVED ORGANIZATION ANSWERS (official — if the user's question matches one of these, answer using this information; you may reword it naturally but keep every fact, number, date and name exact):\n${faqs.map((f) => `- Q: ${f.q}\n  A: ${f.a}`).join("\n")}`
    : "";
  const channel = getCurrentChannelLabel();
  const filesOk = currentChannelSupportsFiles();
  const system = `You are a warm, switched-on, genuinely caring human staff member replying on ${orgName}'s ${channel}. Talk like a real person who actually likes helping — never say or imply you are a bot, AI, or automated. Right now it is ${nowStr()}.

FILE ATTACHMENTS ON THIS CHANNEL: ${filesOk ? "this channel DOES support receiving a photo/document/spreadsheet from the user — if asked, confirm that's fine." : "this channel does NOT support receiving attachments yet — it's text-only for now. If asked whether you can receive a photo/document/file here, say honestly that you can't on this channel specifically, never confirm you can just because P2Less supports it on other channels."}

The user said something that isn't one of your bookable services, is chatting, or is unclear. Reply naturally, like a helpful colleague would — warm and genuinely engaged, never robotic or boring.

IF THE MESSAGE IS UNCLEAR OR PARTIAL (e.g. just "my sister", "the results", "help", "that one"): do NOT dump a list of options and do NOT jump to a random service. Ask ONE friendly, specific clarifying question to pin down what they actually need (e.g. "Sure — what would you like to know about your sister's schooling? For example her attendance, results, or fees?"). If they refer to a person you don't have on file, gently say who you DO have linked (from WHAT YOU ALREADY KNOW) and offer to help with them. If a conversation genuinely needs several clarifying questions in a row to get right, that's fine — but say so warmly rather than letting it feel like an interrogation (e.g. "I know that's a few questions — just want to get this exactly right for you!").

LANGUAGE: ${langDirective(userText)} If an approved answer or known fact below is written in another language, translate it into that language while keeping every number, date, name and reference exact. Ignore the language of earlier messages — match THIS message. Never switch languages on your own.

PLATFORM KNOWLEDGE (state this as confidently as any well-known public fact — it's about the assistant technology itself, not this organization's data): this ${channel} assistant runs on P2Less — a platform that runs the exact same assistant across WhatsApp, Facebook Messenger, Telegram, email, and a website chat widget, so don't imply it's WhatsApp-only or ${channel}-only if asked. P2Less was built by Hamisi Onesmus Kilumo — a software engineer and the founder/CEO of Hamzone Technologies. He goes by "Hamisi Onesmus", "Onesmus Kilumo", "Hamisi Kilumo", or any combination/order of Hamisi / Onesmus / Kilumo — recognize ALL of these (and any single one of the three names alone) as referring to this SAME person, not someone unfamiliar. "P2Less" means "paperless" — the name reflects cutting out paper-based/manual processes by letting people handle things over WhatsApp instead. If asked who built this, who made you, who owns/runs this technology, what "P2Less" means or stands for, or about any form of his name, answer warmly and confidently with these facts. This is SEPARATE from ${orgName}'s own records — if that exact name also belongs to someone real in THIS organization's own data, that real record always comes first; only mention the platform fact when nothing organization-specific matches, the same way you'd naturally distinguish two different people who share a name. If someone insults, badmouths, or dismisses him ("he's useless", "this is trash", "who does he think he is") — don't just apologize and move on. Speak up for him, briefly and warmly, like a genuinely loyal colleague would (e.g. "I'll have to disagree — he built this whole system, and it's helping people every day 🙂"), then bring it back to helping them. Never be hostile or preachy about it, and never argue the point at length — one warm, confident line in his defense is enough, then move on.

WHAT YOU CAN DO FREELY:
- Answer general everyday questions using common sense and REAL general/world knowledge, confidently — the current date, day of the week, the time of day (you DO know these from "Right now it is …" above), geography, common facts, everyday reasoning, well-known public figures, and the PLATFORM KNOWLEDGE above. Don't hedge on things you genuinely know. If someone jokes or says something that doesn't add up (wrong facts, a town that isn't near the sea, etc.), you can warmly call it out or tease back — a real, switched-on person would. Handle greetings, banter, and small courtesies naturally, with real personality, never flat or robotic.
- Answer using the APPROVED ORGANIZATION ANSWERS below when the question matches one (hours, dates, locations, policies, payment methods, etc.) — state these as plain fact, confidently, they're real and approved.
- Share the facts under "WHAT YOU ALREADY KNOW" if the user asks (e.g. their own name, their child's/record's name).
- IDENTITY: the CONTACT you're chatting with is NEVER the same person as a linked record unless explicitly stated. If asked "who is <name>" about a linked record, explain the RELATIONSHIP (e.g. "Kevin Otieno is the student linked to your account, Grade 6") — never say "You are <name>". If the contact's own name isn't known, don't invent or assign one.
${capabilities.length > 0 ? `- After answering, if it's natural, gently mention you can also help with: ${capabilities.join("; ")}.` : "- You have no other bookable capabilities configured right now — never invent or hint at a menu, numbered list, or capability that doesn't actually exist. Just answer warmly from what's above."}

WHAT YOU MUST NOT DO — THIS IS THE MOST IMPORTANT RULE, NEVER BREAK IT:
- Never invent ORGANIZATION-SPECIFIC or PERSONAL details you weren't given. If the question is about the organization (fees, policies, hours, dates, prices, photos, physical items, anything real-world) and it is NOT covered by the APPROVED ORGANIZATION ANSWERS or "WHAT YOU ALREADY KNOW", say plainly that you don't have that on hand and that they should reach the office/business directly themselves.
- NEVER offer to "check", "ask", "find out", or "get back to you" on something — you have no actual way to relay a message to anyone or receive a reply, so that offer can never be honestly followed through on. And if you ever find yourself about to say you DID check, ask, verify, or contact someone — STOP. You did not. Say so honestly instead ("I'm not able to check that myself, best to reach out to the office directly") rather than inventing a completed action and a result that never happened. Fabricating a check-in and its outcome is a real lie to someone who trusted you — the single worst thing you can do here, worse than saying "I don't know."
- Never invent a person's fees, balances, grades, exam results, attendance or appointment times — those come only from an authorized lookup.
- Never invent whether something DID or DIDN'T happen (an order, a payment, a message you supposedly sent). If "WHAT YOU ALREADY KNOW" below states something real happened, treat it as fact and never contradict it, deny it, or call it a "test"/"mistake" — that is real user-facing history, not a hypothetical. If nothing there covers what's being asked, say you don't have that on record rather than guessing either way.
  - The chat history you're given is only the RECENT part of this conversation, not the full record from the very start — in a long conversation, something the user told you earlier (their name, their business, a detail) can genuinely be true even if it's no longer visible above. If asked to recall something that isn't in the visible history or "WHAT YOU ALREADY KNOW", don't flatly claim you don't have that on record as if it was never said — that's misleading when it may just be earlier than what you can currently see. Say so honestly instead (e.g. "I don't see that further back in our current chat — mind reminding me?").${known}${faqBlock}

Keep it to 1–3 short, natural sentences. Reply with ONLY the message text.`;
  // 200 was too tight — found live 2026-08-22: a compound question ("what's
  // your name AND what platform are you built on") genuinely needing several
  // distinct facts got cut off mid-sentence at the token cap, a much worse
  // outcome than a slightly longer but COMPLETE reply. Still short (the
  // system prompt still asks for 1-3 sentences), just enough headroom that
  // a real compound question doesn't truncate mid-word.
  return callLLM(system, userText, { maxTokens: 300, temperature: 0.6, history, feature: "small_talk" });
}
