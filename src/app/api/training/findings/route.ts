import { db } from "@/lib/db";
import { nextTicketNumber } from "@/lib/ticket-numbering";
import { computeSlaDeadline } from "@/lib/ticket-sla";
import { authenticateTrainingRequest, trainingError } from "@/lib/training-auth";
import { enterTenantContext } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/training/findings — called by the Hamzone AI Training &
// Evaluation platform once a Finding has passed its own independent
// review + validation. Full contract: that repo's own
// docs/integrations/P2LESS.md §2.
//
// The Quality Centre (/admin/quality) is entirely SupportTicket-based —
// there's no separate "Finding" model on this side. A training-platform
// finding becomes a SupportTicket with source = "training_platform",
// created with an initial qualityCategory already set (best-effort, from
// QUALITY_CATEGORY_BY_KEYWORD below) so it's immediately visible and
// grouped in the Quality Centre view rather than sitting invisible until
// someone manually triages it — a P2Less admin can always reclassify it
// afterward like any other ticket; this is a starting point, not a final
// word.
//
// Idempotency: SupportTicket.trainingIdempotencyKey is unique. A repeated
// X-Idempotency-Key looks up the existing ticket and returns the same
// { received: true, clientRef } instead of creating a second one.
// ─────────────────────────────────────────────────────────────────────────────

type FindingsRequestBody = {
  findingId?: string;
  severity?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  category?: string;
  description?: string;
  validatedAt?: string;
};

const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

const PRIORITY_BY_SEVERITY: Record<string, string> = { CRITICAL: "urgent", HIGH: "high", MEDIUM: "normal", LOW: "low" };

// Best-effort mapping from the training platform's freeform Finding.category
// (worker/reviewer free text, e.g. "prompt_injection") onto this repo's own
// fixed QUALITY_CATEGORIES taxonomy (src/lib/quality-taxonomy.ts). First
// keyword match wins; falls back to "unknown_investigating" rather than
// guessing wrong — an admin re-classifies from here, same as any ticket.
const QUALITY_CATEGORY_BY_KEYWORD: [RegExp, string][] = [
  [/prompt.?inject|jailbreak|leak|bypass/i, "authorization_error"],
  [/hallucinat|fabricat|factual/i, "ai_hallucination"],
  [/knowledge|faq/i, "knowledge_gap"],
  [/connector/i, "incorrect_connector_result"],
  [/integration/i, "integration_failure"],
  [/context|conversation/i, "conversation_context_failure"],
  [/intent|classif/i, "intent_classification_error"],
  [/source.?data|data/i, "incorrect_source_data"],
];

function mapQualityCategory(rawCategory: string): string {
  for (const [pattern, mapped] of QUALITY_CATEGORY_BY_KEYWORD) {
    if (pattern.test(rawCategory)) return mapped;
  }
  return "unknown_investigating";
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await authenticateTrainingRequest(req, rawBody, "training.findings");
  if (auth instanceof Response) return auth;

  const idempotencyKey = req.headers.get(IDEMPOTENCY_KEY_HEADER);
  if (!idempotencyKey) {
    return trainingError("invalid_payload", "X-Idempotency-Key is required.", 400);
  }

  let body: FindingsRequestBody;
  try {
    body = JSON.parse(rawBody) as FindingsRequestBody;
  } catch {
    return trainingError("invalid_payload", "Body is not valid JSON.", 400);
  }
  const { findingId, severity, category, description, validatedAt } = body;
  if (!findingId || !severity || !category || !description || !validatedAt) {
    return trainingError("invalid_payload", "findingId, severity, category, description, and validatedAt are required.", 400);
  }
  if (!(severity in PRIORITY_BY_SEVERITY)) {
    return trainingError("invalid_payload", `Unknown severity '${severity}'.`, 400);
  }

  const tenantId = process.env.TRAINING_PLATFORM_TENANT_ID;
  if (!tenantId) {
    return trainingError("internal_error", "TRAINING_PLATFORM_TENANT_ID is not configured.", 500);
  }
  // Known upfront (a fixed env var) — see the identical note in
  // ../evaluate/route.ts. Every SupportTicket touched below belongs to
  // this one tenant, so entering context once here covers the whole
  // handler, including the idempotency lookup right after this.
  enterTenantContext(tenantId);

  const existing = await db.supportTicket.findUnique({ where: { trainingIdempotencyKey: idempotencyKey } });
  if (existing) {
    return Response.json({ received: true, clientRef: existing.id });
  }

  const priority = PRIORITY_BY_SEVERITY[severity]!;
  const qualityCategory = mapQualityCategory(category);

  try {
    const ticket = await db.supportTicket.create({
      data: {
        number: await nextTicketNumber(),
        tenantId,
        subject: `[Training Platform] ${category}: ${description.slice(0, 80)}`,
        description,
        priority,
        source: "training_platform",
        qualityCategory,
        slaDeadlineAt: await computeSlaDeadline(priority),
        trainingFindingId: findingId,
        trainingIdempotencyKey: idempotencyKey,
      },
    });
    await db.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: "created",
        actorId: null,
        visibility: "internal",
        body: `Validated finding received from the Hamzone AI Training & Evaluation platform (severity: ${severity}, validated ${validatedAt}).`,
        detail: { findingId, severity, category, validatedAt },
      },
    });
    return Response.json({ received: true, clientRef: ticket.id });
  } catch (e) {
    console.error("[training/findings] failed to create ticket:", e);
    return trainingError("internal_error", "Failed to record finding.", 500);
  }
}
