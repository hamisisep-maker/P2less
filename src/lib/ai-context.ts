import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Carries the CURRENT tenant through to the AI cost ledger (AiRequestLog in
// ai.ts) without threading a tenantId parameter through every one of the ~20
// call sites across conversation.ts. Set once, right after the tenant is
// resolved in handleInbound(), via enterWith() (not .run()) — it applies to
// the REST of the current async call chain from that point on, no need to
// restructure handleInbound into a wrapped callback.
// ─────────────────────────────────────────────────────────────────────────────

type AiContext = { tenantId: string };

const storage = new AsyncLocalStorage<AiContext>();

/** Call once per inbound request, right after the tenant is known. */
export function setAiTenantContext(tenantId: string): void {
  storage.enterWith({ tenantId });
}

/** Read by ai.ts's cost logger. Undefined when no tenant is known yet (e.g.
 *  voice-note transcription runs before routing resolves the tenant) — the
 *  cost is still logged, just without tenant attribution, rather than guessed. */
export function getAiTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
