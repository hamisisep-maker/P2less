import { handleInbound } from "@/lib/conversation";
import { authenticateTrainingRequest, trainingError } from "@/lib/training-auth";
import { enterTenantContext } from "@/lib/tenant-context";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/training/evaluate — called by the Hamzone AI Training &
// Evaluation platform (separate repo/database — see that repo's
// docs/integrations/P2LESS.md for the full frozen contract this
// implements). Runs a test input through the REAL conversation pipeline
// (handleInbound()) and returns what the assistant actually said.
//
// handleInbound() has no "don't persist" mode — it always creates a
// Contact/Conversation/Message and meters real usage (src/lib/usage.ts).
// Rather than fork that shared pipeline for this one caller (a much bigger,
// riskier change than this integration warrants), evaluation traffic is
// routed at a single designated tenant (TRAINING_PLATFORM_TENANT_ID — a
// real Tenant meant for exactly this, e.g. Hamzone's own dogfood account,
// never a paying customer's), using a synthetic Contact per request
// (address "training-eval:<requestId>") so it's never mistaken for a real
// customer and never shares conversation context across unrelated test
// runs. This does create real rows in that tenant over time — an accepted,
// documented operational cost, not a bug.
// ─────────────────────────────────────────────────────────────────────────────

type EvaluateRequestBody = {
  requestId?: string;
  input?: { text?: string; context?: Record<string, unknown> };
};

export async function POST(req: Request) {
  const rawBody = await req.text();
  const auth = await authenticateTrainingRequest(req, rawBody, "training.evaluate");
  if (auth instanceof Response) return auth;

  let body: EvaluateRequestBody;
  try {
    body = JSON.parse(rawBody) as EvaluateRequestBody;
  } catch {
    return trainingError("invalid_payload", "Body is not valid JSON.", 400);
  }
  const text = body.input?.text;
  const requestId = body.requestId;
  if (!requestId || typeof requestId !== "string" || !text || typeof text !== "string") {
    return trainingError("invalid_payload", "requestId and input.text are required.", 400);
  }

  const tenantId = process.env.TRAINING_PLATFORM_TENANT_ID;
  if (!tenantId) {
    return trainingError("internal_error", "TRAINING_PLATFORM_TENANT_ID is not configured.", 500);
  }
  // Known upfront (a fixed env var, not resolved from the request the way a
  // channel webhook resolves its tenant) — same enterTenantContext() convention
  // every other entry point uses once its tenant is known (tenant-context.ts).
  enterTenantContext(tenantId, "widget");

  try {
    const result = await handleInbound({
      tenantId,
      fromNumber: `training-eval:${requestId}`,
      channelType: "widget",
      text,
      displayName: "Hamzone Training Evaluation",
    });
    const responseText = result.replies.map((r) => r.body).filter(Boolean).join("\n\n");
    if (!result.ok || !responseText) {
      console.error("[training/evaluate] handleInbound returned no usable reply:", JSON.stringify(result));
      return trainingError("internal_error", "P2Less produced no reply for this input.", 500);
    }
    return Response.json({ ok: true, responseText, meta: { conversationId: result.conversationId } });
  } catch (e) {
    console.error("[training/evaluate] handleInbound failed:", e);
    return trainingError("internal_error", "Evaluation failed unexpectedly.", 500);
  }
}
