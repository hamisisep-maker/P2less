import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { understand, humanizeReply, smallTalk, complete, aiEnabled, partOfDay, nowStr, classifyCommerceMessage, resolveOrderStepAnswer, type ChatTurn, type CommerceIntent } from "./ai";
import { executeAction, type ParamSpec } from "./connector-engine";
import { issueOtp, verifyOtp, hasVerifiedSession } from "./otp";
import { hasPermission } from "./permissions";
import { audit } from "./audit";
import { meter, checkLimit } from "./usage";
import { deliver, sendWhatsAppText } from "./transport";
import { handleDriverMessage, matchDeliveryZone, tryAssignTrip } from "./dispatch";
import { generateReportCard, generatePayslipPdf, generateLeavePdf, generateFeeStatementPdf, generateCvPdf, type GeneratedDoc } from "./documents";
import { isCvRequest, extractCvData } from "./cv-writer";
import { requestId as newRequestId, randomToken } from "./crypto";
import { isCatalogBrowseRequest, isOrderRequest, formatCatalog, matchProduct, extractQuantity, startOrderPayment, findExactProductMention, hasExplicitQuantity, isProductImageRequest, isProductAttributeQuestion, isStockQuestion, isDeliveryIntent, isPickupIntent, isAddressDetailed, reserveStock, isAvailable } from "./catalog";
import { dispatchWebhook } from "./webhooks";
import { extractDate, extractTime, isGreeting, type IntentAction } from "./intent-engine";
import { pickTool, allTools } from "./tools";
import { startTopup, creditRateKes, creditsForAmount } from "./wallet";
import { isConfigured as mpesaConfigured } from "./mpesa";
import { setAiTenantContext } from "./ai-context";
import { enterTenantContext, currentChannelSupportsFiles, getCurrentChannelLabel, runCrossTenant } from "./tenant-context";
import { nextTicketNumber } from "./ticket-numbering";
import { queueNotification } from "./notifications";
import { resolveNumberBranch } from "./branches";
import { evaluateCapabilityGate } from "./capability-gate";
import { evaluateWorkflowAsk } from "./workflow-engine";
import type { FactSource } from "./provenance";
import { computeSlaDeadline } from "./ticket-sla";
import { findLikelyDuplicate } from "./duplicate-detection";
import { detectDistressSignal } from "./safeguarding";

// ─────────────────────────────────────────────────────────────────────────────
// Conversation orchestrator — the channel-agnostic core pipeline:
//
//   resolve identity → record → (resume pending step | detect intent)
//   → resolve entities/params → authorize → step-up (OTP) → confirm (writes)
//   → execute connector → format → (document) → audit → reply
//
// Every channel (web chat, WhatsApp, SMS) funnels through handleInbound(). No
// business logic lives in any channel adapter.
// ─────────────────────────────────────────────────────────────────────────────

export type InboundInput = {
  toNumber?: string; // the ORGANIZATION number the user messaged — the routing key. Omit when tenantId is given directly.
  // Universal Platform roadmap Phase 8e (2026-08-20) — direct tenant routing
  // for channels with no phone number at all (the website widget). Bypasses
  // the WhatsAppNumber lookup entirely; exactly one of toNumber/tenantId must
  // be set.
  tenantId?: string;
  fromNumber: string; // the sender's number — an identity signal, never sufficient alone
  channelType: string; // whatsapp | webchat | widget | messenger | telegram | email | sms (transport only)
  text: string;
  displayName?: string;
  // Super-app: an attached file (document/spreadsheet/image) to run a tool on.
  attachment?: { base64: string; filename: string; mimeType: string };
};

export type Reply = { body: string; kind?: "text" | "otp_hint" | "document" | "image" | "system"; meta?: Record<string, unknown>; document?: { url: string; filename: string }; image?: { url: string } };
export type HandleResult = {
  ok: boolean;
  replies: Reply[];
  conversationId?: string;
  // The identity the user sees replies coming from — the ORGANIZATION, not P2Less.
  from?: { number: string; name: string };
};

type ConvContext = {
  pendingActionId?: string;
  pendingActionKey?: string;
  pendingParams?: Record<string, unknown>;
  pendingResolved?: Record<string, unknown>;
  otpChallengeId?: string;
  missingParam?: string;
  missingEntity?: string;
  lastResource?: LastResource;
  // Set when an OTP is the final step of self-service account linking.
  pendingLink?: { grantKey: string; roleKey: string; personId: string; name: string };
  // Ordered action ids behind the last numbered menu we showed (reply "1"/"2").
  menu?: string[];
  // How many stray (non-answer) messages we've fielded while collecting a param /
  // waiting for confirm — used to stop re-asking after the user clearly moved on.
  paramAsides?: number;
  // The last document a tool read for this person (capped excerpt) — lets a
  // text-only follow-up ("what does it say about X?") work without re-sending it.
  lastDocument?: { label: string; text: string; ts: number };
  // Accumulated raw text while conversationally building a CV across turns.
  // asides counts non-productive replies, so we stop repeating the identical
  // canned prompt and instead acknowledge + rephrase from the 2nd try onward.
  cvBuilder?: { rawText: string; asides?: number };
  // A product order being built up step by step — never skip a step the
  // product/order actually needs, so nobody ends up paying for something they
  // didn't fully specify.
  pendingOrder?: {
    productId: string; productName: string; quantity: number; unitPrice: number; currency: string;
    options?: string | null; // copied from the product — what they need to choose (color/size/etc.), if anything
    optionChosen?: string; // their free-text answer to `options`
    fulfillment?: "pickup" | "delivery";
    deliveryAddress?: string;
    deliveryFee?: number; // matched from a DeliveryZone once the address is known; 0/unset = not matched
    deliveryZoneName?: string;
    paymentPhone?: string; // the M-Pesa number to charge — asked explicitly, never assumed to be the sender's own WhatsApp number
    questionsAsked?: number; // how many order-flow questions asked so far — so a long chain gets a warm acknowledgment, not silence
  };
  // The most recently PLACED order (pending payment or paid) — kept in context so
  // a follow-up question right after ("which number did you send it to?") can be
  // answered from real data instead of the AI having nothing to go on and
  // denying the order ever happened.
  lastOrder?: { reference: string; productName: string; quantity: number; total: number; currency: string; phone: string; status: "pending_payment" | "paid" };
  // Set by dispatch.ts when a driver reports a delivery complete — the
  // customer's next message is their real feedback on THIS trip.
  awaitingFeedbackTripId?: string;
  // A "which student/employee/patient do you mean?" list is pending — a bare
  // "1"/"2" reply (or the name) must resume the ORIGINAL action with that
  // resource, not be reprocessed as a fresh message (which just re-triggers
  // the same ambiguous match and repeats the identical question forever).
  pendingDisambiguation?: { actionId: string; entities: Record<string, string>; candidates: { id: string; name: string }[] };
  // The most recently completed WRITE action (booking, cancellation, leave
  // request, etc.) — same reasoning as lastOrder: a follow-up right after
  // ("did you actually book it?") must be answered from real data, not a
  // generic capability denial or an invented confirmation either way.
  lastAction?: { description: string; key: string };
};

// The user signalling they didn't want this pending flow / are confused by the
// prompt — we abandon rather than keep asking. Catches "I didn't ask for a date",
// "date for what?", "what's wrong", "makes no sense", etc.
const PUSHBACK = /\b(not (asked?|request)|did ?n'?t ask|have ?n'?t ask|haven'?t ask|never ask|no ?one ask|didn'?t request|for what|why (a )?date|why (are|you|do)|who asked|not interested|don'?t want|makes no sense|what'?s wrong|stop asking|this is (wrong|annoying)|i hate)\b/i;

// A SHORT, direct yes/no reply — deliberately NOT just "does the message contain
// the word confirm/yes/cancel anywhere". A longer sentence that merely mentions
// one of those words in passing ("I need to confirm if my son arrived at
// school") is NOT authorization to complete a purchase or write action — that
// would fire a real M-Pesa charge or a real booking on a false positive. Requires
// the message to be short, not phrased as a question, and not about some other
// topic before the word even counts as an answer.
const OTHER_TOPIC_HINT = /\?|\b(if|whether|wonder|wondering|know|check|fee|balance|attendance|appointment|meeting|exam|results?|leave|payslip|salary|school|student|class|grade|arrived|son|daughter|child)\b/i;
function isDirectReply(lower: string, pattern: RegExp): boolean {
  const trimmed = lower.trim().replace(/[.!]+$/, "");
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount <= 6 && !OTHER_TOPIC_HINT.test(trimmed) && pattern.test(trimmed);
}

/** Is this a genuine question, even without a "?" — real, reported bug: "which
 *  one is available" (no question mark) slipped past a punctuation-only check
 *  in an order-flow state and got silently treated as a literal answer value.
 *  Never trust "?" alone to detect a question. */
function looksLikeAQuestion(text: string): boolean {
  const t = text.trim();
  return /\?/.test(t) || /^\s*(which|what|who|why|how|when|where|do you|does it|is there|are there|can (i|you)|could (i|you)|any idea|any of)\b/i.test(t);
}

/** Does this message plausibly look like someone typing an admission/
 *  employee/patient ID, as opposed to a genuine message? Every real ID
 *  format used in this system is a short alphanumeric token, usually with a
 *  digit and often a hyphen ("STU-001", "ADM-1002", "EMP-184") — essentially
 *  never a multi-word sentence or one containing ordinary English words.
 *  Deliberately a POSITIVE check (does this look like an ID) rather than a
 *  negative one (does this look like a question) — a narrower "is this a
 *  question" filter missed real messages like "hello how are you" (no "?",
 *  doesn't start with a question word), letting them fall through into a
 *  failed ID-match attempt. Defaults to false (treat as a genuine message,
 *  answer it for real) for anything ambiguous — wrongly treating a real
 *  message as a bad ID attempt is worse than occasionally re-prompting for
 *  a genuinely malformed ID. */
function looksLikeIdAttempt(text: string): boolean {
  const t = text.trim();
  if (!t || !/\d/.test(t)) return false;
  if (t.split(/\s+/).filter(Boolean).length > 2) return false;
  if (/\b(hello|hi|hey|how|are|you|what|when|where|why|who|please|thanks|thank|is|the|can|do|does|my|son|daughter|child)\b/i.test(t)) return false;
  return true;
}

// A resource the contact is authorized to reference — a student, employee,
// patient, order, member, etc. The grants JSON holds arrays keyed by type.
type ResourceGrant = { id: string; name: string; grade?: string; [k: string]: unknown };
type LastResource = { id: string; name: string; grade?: string; grantKey?: string };

/** Canonicalize a phone/address to E.164 with a leading "+". WhatsApp delivers
 *  senders without the "+"; stored contacts keep it — this makes them match. */
export function normalizePhone(n: string): string {
  const t = n.trim();
  if (t.startsWith("+")) return "+" + t.slice(1).replace(/[^\d]/g, "");
  const digits = t.replace(/[^\d]/g, "");
  // Only treat it as a phone number if it's all digits (leave chat ids alone).
  return digits === t.replace(/[\s-]/g, "") && digits.length >= 7 ? "+" + digits : t;
}

export async function handleInbound(input: InboundInput): Promise<HandleResult> {
  const reqId = newRequestId();

  // ── ROUTING: either the destination number → organization number → tenant
  // (the original design, WhatsApp/webchat), or directly by tenantId for a
  // channel with no phone number at all (the website widget, Phase 8e — the
  // widget route already resolved the tenant via its own WidgetKey lookup
  // before calling here). Both paths converge on the same tenant/assistant/
  // fromIdentity/branding/numberId values; everything after this block is
  // unchanged and genuinely channel-agnostic. ────────────────────────────
  let number: Prisma.WhatsAppNumberGetPayload<{ include: { tenant: { include: { subscription: true } } } }> | null = null;
  let tenant: Prisma.TenantGetPayload<{ include: { subscription: true } }>;
  let assistant: string;
  let fromIdentity: { number: string; name: string };
  let branding: { assistantName?: string; welcome?: string; poweredBy?: string };
  let branchLookup: { branchId: string | null; tenantId: string };
  // Messenger's routing identity (the org's connected Facebook Page id) —
  // same role as WhatsAppNumber.phoneNumberId, resolved via the tenantId
  // direct-routing path below since Messenger has no phone number.
  let fromPageId: string | null = null;
  // Same role again, for Telegram — the org's connected bot's own id.
  let fromTelegramBotId: string | null = null;

  if (input.tenantId) {
    const t = await db.tenant.findUnique({ where: { id: input.tenantId }, include: { subscription: true } });
    if (!t || t.status === "suspended") {
      return { ok: false, replies: [{ body: "This service is not available." }] };
    }
    tenant = t;
    branding = (tenant.branding as { assistantName?: string; welcome?: string; poweredBy?: string } | null) ?? {};
    assistant = branding.assistantName ?? tenant.name;
    fromIdentity = {
      number: input.channelType === "messenger" ? "messenger" : input.channelType === "telegram" ? "telegram" : input.channelType === "email" ? "email" : "widget",
      name: assistant,
    };
    branchLookup = { branchId: null, tenantId: tenant.id };
    // Deliberately cross-tenant — this whole routing block runs BEFORE
    // enterTenantContext() below resolves who "the current tenant" even is.
    // Found in the same 2026-08-23 fail-closed audit as every other
    // identity-resolution lookup.
    if (input.channelType === "messenger") {
      const channel = await runCrossTenant(() => db.channel.findFirst({ where: { tenantId: tenant.id, type: "messenger", status: "active" } }));
      fromPageId = channel?.address ?? null;
    }
    if (input.channelType === "telegram") {
      const channel = await runCrossTenant(() => db.channel.findFirst({ where: { tenantId: tenant.id, type: "telegram", status: "active" } }));
      fromTelegramBotId = channel?.address ?? null;
    }
  } else {
    // Deliberately cross-tenant — resolves WHICH tenant this destination
    // number belongs to, before any context can exist. Same category of
    // gap as every channel webhook's own lookup, found in the same
    // 2026-08-23 fail-closed audit — this is the ADDITIONAL internal lookup
    // handleInbound() itself does (separate from the webhook route's own
    // phoneNumberId lookup, already fixed), hit by every caller that routes
    // via toNumber instead of a pre-resolved tenantId (webchat, and the
    // real WhatsApp webhook, which passes toNumber here too).
    const num = await runCrossTenant(() => db.whatsAppNumber.findUnique({
      where: { phoneNumber: input.toNumber },
      include: { tenant: { include: { subscription: true } } },
    }));
    if (!num || num.status !== "active" || num.tenant.status === "suspended") {
      // Unknown/inactive number: nothing to reply as, and no tenant to bill/audit.
      return { ok: false, replies: [{ body: "This number is not in service." }] };
    }
    number = num;
    tenant = num.tenant;
    // The identity the user sees is the ORGANIZATION (per-number branding wins).
    const numBranding = (num.branding as { assistantName?: string; welcome?: string } | null) ?? {};
    const tenantBranding = (tenant.branding as { assistantName?: string; welcome?: string; poweredBy?: string } | null) ?? {};
    branding = { ...tenantBranding, ...numBranding };
    // Real bug found live-testing the new /dashboard/settings page,
    // 2026-08-23: this used to unconditionally read num.displayName,
    // completely bypassing the branding merge one line above — editing
    // "Assistant name" in Settings had zero effect on WhatsApp/webchat
    // (the majority real channel), only on the widget/direct-tenantId path
    // above, which correctly did `branding.assistantName ?? tenant.name`.
    // Fixed to respect the same merge (per-number branding, then tenant
    // branding, matching the comment's own stated intent), falling back to
    // the number's own displayName only when neither branding source set one.
    assistant = branding.assistantName ?? num.displayName; // e.g. "Hamzone Technologies"
    fromIdentity = { number: num.phoneNumber, name: num.displayName };
    branchLookup = { branchId: num.branchId, tenantId: tenant.id };
  }
  // Every AI call from here on (understand/smallTalk/humanizeReply/etc., deep
  // inside this function) attributes its real token cost to this tenant —
  // see ai-context.ts for why this is enterWith() rather than a param threaded
  // through ~20 call sites.
  setAiTenantContext(tenant.id);
  // Tenant-isolation hardening — same reasoning, same enterWith() pattern:
  // every query from here on (deep inside this function, across every
  // channel that funnels through handleInbound — WhatsApp/Messenger/
  // Telegram/Email/widget/webchat) runs under the tenant-scoping Prisma
  // extension (db.ts), scoped to this tenant. Also carries the real channel
  // type so smallTalk() (ai.ts) can describe itself correctly instead of
  // assuming WhatsApp.
  enterTenantContext(tenant.id, input.channelType);

  // Identity: resolve/create the contact (scoped to THIS tenant) by sender number.
  // Normalize to canonical E.164 so a WhatsApp sender ("254739536255") and a
  // stored contact ("+254739536255") resolve to the same person across channels.
  const senderAddress = normalizePhone(input.fromNumber);

  // ── Driver routing: a registered driver messaging this SAME number is never
  // treated as a customer — no Contact/Conversation is created for them, their
  // messages are structured commands (accept/decline/available/delivered)
  // handled entirely separately, never AI small talk. ──────────────────────
  const driver = await db.driver.findFirst({ where: { tenantId: tenant.id, active: true, phone: senderAddress } });
  if (driver) {
    const body = await handleDriverMessage(driver, input.text);
    if (input.channelType === "whatsapp" && number?.phoneNumberId) {
      await sendWhatsAppText(number.phoneNumberId, input.fromNumber, body);
    }
    return { ok: true, replies: [{ body }], conversationId: `driver:${driver.id}`, from: fromIdentity };
  }

  // Identity spans channels: a person's number is who they are whether they reach
  // the org via WhatsApp, the web simulator, or SMS. Reuse an existing contact for
  // this number (and its grants/roles) rather than forking one per transport.
  let contact = await db.contact.findFirst({
    where: { tenantId: tenant.id, address: senderAddress },
    include: { contactRoles: { include: { role: true } } },
  });
  if (!contact) {
    contact = await db.contact.create({
      data: { tenantId: tenant.id, channelType: input.channelType, address: senderAddress, displayName: input.displayName },
      include: { contactRoles: { include: { role: true } } },
    });
  }

  // A conversation is per (contact, organization number) — for a numberless
  // channel (the widget), numberId is explicitly null, not omitted, so this
  // stays scoped to "this contact's widget conversation" specifically rather
  // than accidentally matching a WhatsApp conversation for the same person.
  let conversation = await db.conversation.findFirst({
    where: { tenantId: tenant.id, contactId: contact.id, numberId: number?.id ?? null, status: { not: "closed" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    // Resolved ONCE at creation, same as tenantId/numberId — routing metadata,
    // not conversational state, so it belongs on the row itself rather than
    // in `context` (which many call sites below replace wholesale per emit()
    // rather than merge, so anything stashed there isn't durable).
    const branch = await resolveNumberBranch(branchLookup);
    conversation = await db.conversation.create({
      data: { tenantId: tenant.id, contactId: contact.id, numberId: number?.id ?? null, branchId: branch?.id, status: "open", context: {} },
    });
  }

  // Record inbound + meter (enforce message limits).
  const limit = await checkLimit(tenant.id, "message_in");
  await db.message.create({ data: { tenantId: tenant.id, conversationId: conversation.id, direction: "in", body: input.text, requestId: reqId } });
  await meter(tenant.id, "message_in");
  void dispatchWebhook(tenant.id, "message.received", { conversationId: conversation.id, from: input.fromNumber, to: input.toNumber, text: input.text }).catch(() => {});
  if (!limit.ok) {
    const reply: Reply = { body: "This service has reached its monthly message limit. Please contact the organization." };
    await deliver({ tenantId: tenant.id, conversationId: conversation.id, channelType: input.channelType, to: input.fromNumber, body: reply.body, fromNumberId: number?.phoneNumberId, fromPageId, fromTelegramBotId });
    return { ok: true, replies: [reply], conversationId: conversation.id, from: fromIdentity };
  }

  const ctx = (conversation.context as ConvContext | null) ?? {};
  const permissions = contact.contactRoles.flatMap((cr) => (cr.role.permissions as string[]) ?? []);
  const grants = (contact.grants as Record<string, ResourceGrant[]> | null) ?? {};

  // Recent conversation memory — so the AI can follow topic switches, resolve
  // references ("her fees", "that one") and reply in the natural flow. We just
  // recorded the inbound message above, so drop it and keep the prior turns.
  const recent = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: 11,
    select: { direction: true, body: true },
  });
  const history: ChatTurn[] = recent
    .slice(1) // drop the just-recorded current inbound message
    .reverse()
    .map((m) => ({ role: m.direction === "in" ? ("user" as const) : ("assistant" as const), text: m.body }));

  // Facts the AI is ALLOWED to share in casual conversation (identity-level only,
  // straight from this contact's grants — not sensitive data like fees/grades,
  // which still require an authorized lookup). Lets it answer "what's my child's
  // name?" like a person, without inventing anything.
  const knownFacts = buildKnownFacts(contact.displayName, grants, ctx.lastOrder, ctx.lastAction);
  // Org-approved FAQs (school hours, term dates, payment methods…). The org owns
  // these; the AI may answer from them verbatim but never invents beyond them.
  const orgFaqs = ((tenant.faqs as { q: string; a: string }[] | null) ?? []).filter((f) => f && f.q && f.a);

  // Training Session gate (minimal v1, docs/PUBLIC-FEEDBACK-QUALITY-CENTRE-
  // 2026-08-23.md's TestExercise section, built after seven rounds of
  // design with nothing shipped) — declared here, ahead of emit(), so
  // emit's closure picks up whatever this turn's gate check sets below.
  // Deliberately does NOT alter the real reply; it only appends one extra
  // notice on a participant's final allowed question, via the SAME emit()
  // every reply path already funnels through — so this covers every branch
  // uniformly instead of needing to touch each one.
  let trainingWarnNearLimit = false;

  const emit = async (replies: Reply[], status: string, nextCtx: ConvContext) => {
    await db.conversation.update({ where: { id: conversation!.id }, data: { status, context: nextCtx as object } });
    const finalReplies = trainingWarnNearLimit
      ? [...replies, { body: "You've reached your allocated questions for this P2Less training session. If you found anything incorrect, confusing, unexpected, or broken, please report it now — your team lead will follow up. Thank you for participating!" }]
      : replies;
    for (const r of finalReplies) {
      // otp_hint / system notes are demo aids and are not re-metered as separate sends
      if (r.kind === "otp_hint" || r.kind === "system") continue;
      await deliver({ tenantId: tenant.id, conversationId: conversation!.id, channelType: input.channelType, to: input.fromNumber, body: r.body, meta: r.meta, fromNumberId: number?.phoneNumberId, fromPageId, fromTelegramBotId, document: r.document, image: r.image });
    }
    return { ok: true, replies: finalReplies, conversationId: conversation!.id, from: fromIdentity } satisfies HandleResult;
  };

  // ── Crisis / distress detection — checked FIRST, before ANY state-dependent
  // branching (training codes, identify flow, capability routing) below.
  // Deliberately placed here rather than deeper in the function: the
  // escalation-matcher bug fixed three times in this project's history (see
  // escalateToHuman's own comments) was always the same shape — a check
  // declared too late silently misses whichever states were added before it
  // existed. S10 stress-test finding, 2026-08-23: nothing in the platform
  // detected distress/crisis language at all — the assistant would cheerfully
  // attempt to answer a fee question from someone in crisis. This never
  // attempts to counsel (an AI attempting crisis support is worse than one
  // that immediately hands off) — detection and warm handoff only.
  if (detectDistressSignal(input.text)) {
    return escalateToHuman(contact, conversation, { distress: true });
  }

  // Public join-by-code: the ONLY way a contact can enroll themselves,
  // alongside the admin-driven addTrainingParticipantAction path. A real
  // customer's ordinary message essentially never collides with an 8-char
  // random code (~40 bits of entropy) drawn from an unambiguous alphabet —
  // this is what actually lets Hamzone's one WhatsApp number serve both
  // real customers and public training testers without a separate
  // "access mode" concept: a session is reachable by whichever paths the
  // admin chooses to hand out (a specific phone number added directly, a
  // code shared publicly, or both at once), same underlying enrollment
  // either way. Checked first since a first-time joiner has no
  // TrainingParticipant row yet for the gate below to find.
  {
    const candidateCode = input.text?.trim().toUpperCase();
    if (candidateCode) {
      const joinable = await db.trainingSession.findFirst({ where: { tenantId: tenant.id, status: "active", joinCode: candidateCode } });
      if (joinable) {
        const already = await db.trainingParticipant.findUnique({ where: { sessionId_contactId: { sessionId: joinable.id, contactId: contact.id } } });
        if (!already) {
          const joined = await db.$transaction(async (tx) => {
            if (joinable.maxParticipants !== null) {
              const count = await tx.trainingParticipant.count({ where: { sessionId: joinable.id } });
              if (count >= joinable.maxParticipants) return { full: true as const };
            }
            await tx.trainingParticipant.create({ data: { sessionId: joinable.id, contactId: contact.id } });
            return { full: false as const };
          });
          return emit(
            [{
              body: joined.full
                ? "Thanks for your interest — this training session is already full."
                : `You're in! You have ${joinable.questionsPerParticipant} test questions for "${joinable.name}". Go ahead and try to break it — ask anything.`,
            }],
            "open", ctx,
          );
        }
      }
    }
  }

  // Checked right after emit() is defined so a participant who's already
  // over their limit can be short-circuited immediately, before any
  // AI/connector work runs for their message — a real resource saving, not
  // just a UX nicety.
  //
  // Deliberately does NOT look up "is there an active session for this
  // tenant" first — an active session must never change behavior for a
  // contact nobody explicitly enrolled. Only a contact who's actually a
  // TrainingParticipant (added directly above, or self-joined via code
  // above) is gated at all; a real customer messaging the same tenant
  // number is untouched regardless of session state. This is the actual
  // safety boundary, not a comment — a tenant-wide "if session active,
  // gate everyone" check was the first version and was wrong.
  {
    const existingParticipant = await db.trainingParticipant.findFirst({
      where: { contactId: contact.id, session: { tenantId: tenant.id, status: "active" } },
      include: { session: true },
    });
    if (existingParticipant) {
      const activeSession = existingParticipant.session;
      // Atomic — SQLite's single-writer semantics make one $transaction
      // genuinely close the race window a naive "read count, then write"
      // would leave open under concurrent messages from the same
      // participant. Would need re-verification — a real row lock or
      // constraint-based upsert — before ever running against Postgres
      // with multiple app instances.
      const gate = await db.$transaction(async (tx) => {
        const current = await tx.trainingParticipant.findUniqueOrThrow({ where: { id: existingParticipant.id } });
        if (current.questionCount >= activeSession.questionsPerParticipant) return { overLimit: true as const, count: current.questionCount };
        const p = await tx.trainingParticipant.update({ where: { id: current.id }, data: { questionCount: { increment: 1 } } });
        return { overLimit: false as const, count: p.questionCount };
      });
      if (gate.overLimit) {
        return emit([{ body: "Thank you for participating in this P2Less training session. You've reached your allocated question limit. Your participation has been recorded." }], "open", ctx);
      }
      trainingWarnNearLimit = gate.count === activeSession.questionsPerParticipant;
    }
  }

  // Send ONE message right now, mid-turn — before slow work (reading a document,
  // writing a CV) starts — so the person sees "I'm on it" instead of long silence
  // followed by typing dots. Does NOT touch conversation status/context; the
  // final emit() at the end of this turn still owns that.
  const announceNow = async (body: string) => {
    await deliver({ tenantId: tenant.id, conversationId: conversation!.id, channelType: input.channelType, to: input.fromNumber, body, fromNumberId: number?.phoneNumberId, fromPageId, fromTelegramBotId });
  };

  // The REAL amount to charge — product total plus a matched delivery fee, if
  // any. If delivery was chosen but no zone matched, the fee is NOT charged
  // here (nothing invented) — the shop confirms it separately, as stated to
  // the customer in the recap below.
  const orderGrandTotal = (po: NonNullable<ConvContext["pendingOrder"]>) => po.unitPrice * po.quantity + (po.fulfillment === "delivery" ? po.deliveryFee ?? 0 : 0);

  // Everything REAL that's known about a product, for grounding the AI
  // fallback in the order-step handlers — so it has an actual, complete list
  // of facts to check against instead of an excuse to guess.
  const productKnownFacts = async (po: NonNullable<ConvContext["pendingOrder"]>) => {
    const product = await db.product.findUnique({ where: { id: po.productId } });
    const lines = [`Name: ${po.productName}`, `Price: ${po.currency} ${po.unitPrice.toLocaleString("en-US")} each`];
    if (product?.description) lines.push(`Description: ${product.description}`);
    if (product?.options) lines.push(`Choices available: ${product.options}`);
    return lines.join(". ");
  };

  // Deterministic (no-AI-required) answer for a common product-attribute or
  // stock question asked mid-order. AI can be down or rate-limited exactly
  // when a customer asks something real — without this, that question got
  // silently dropped and the canned pending-step question repeated verbatim,
  // which is the "hard-coded, repeats itself" complaint. Only fires when the
  // message actually asks about an attribute/stock; a genuine answer to the
  // pending step is handled before this is ever reached. Stock is checked
  // live against the DB — never a stale or invented number.
  const productAttributeFallback = async (po: NonNullable<ConvContext["pendingOrder"]>, msgLower: string): Promise<string | null> => {
    if (isStockQuestion(msgLower)) {
      const product = await db.product.findUnique({ where: { id: po.productId } });
      return product?.stockQuantity != null ? `We have ${product.stockQuantity} ${po.productName} in stock right now.` : `${po.productName} is in stock.`;
    }
    if (!/\b(size|sizes|colou?rs?|material|materials?|option|options|choice|choices|spec|specs?)\b/i.test(msgLower)) return null;
    return po.options ? `We have: ${po.options}.` : `We don't have extra size/colour options listed for ${po.productName} — just the standard one.`;
  };

  // Full recap of a pending order — restates EVERYTHING the customer chose
  // (product, option, quantity, delivery/pickup, delivery fee) so CONFIRM is on
  // the real order, never a guess.
  const orderRecapText = (po: NonNullable<ConvContext["pendingOrder"]>) => {
    const itemTotal = po.unitPrice * po.quantity;
    const lines = [`${po.quantity} × ${po.productName}${po.optionChosen ? ` (${po.optionChosen})` : ""} = ${po.currency} ${itemTotal.toLocaleString("en-US")}`];
    if (po.fulfillment === "delivery") {
      if (po.deliveryFee != null) {
        lines.push(`Delivery to: ${po.deliveryAddress} — fee: ${po.currency} ${po.deliveryFee.toLocaleString("en-US")} (${po.deliveryZoneName})`);
        lines.push(`Total to pay: ${po.currency} ${orderGrandTotal(po).toLocaleString("en-US")}`);
      } else {
        lines.push(`Delivery to: ${po.deliveryAddress} (delivery fee not yet set up for this area — the shop will confirm it separately, not included in this payment)`);
      }
    } else {
      lines.push(`Pickup in person — no delivery`);
    }
    if (po.paymentPhone) lines.push(`M-Pesa prompt will be sent to: ${po.paymentPhone}`);
    return lines.join("\n");
  };

  // Advances a pending order to whatever it's still missing — never skips a
  // step. Order: quantity (asked before this is ever called) → options
  // (color/size, only if the product has any) → delivery-vs-pickup → the
  // delivery address (only if delivery) → final recap + CONFIRM/CANCEL. Every
  // step is asked explicitly; nothing is assumed, and the final recap restates
  // everything the customer chose so they confirm the REAL order, not a guess.
  const advanceOrder = async (po: NonNullable<ConvContext["pendingOrder"]>) => {
    // Checked EVERY time quantity is (re-)known — a live re-check, not a stale
    // one from when they first asked, so it reflects what's actually left right
    // now. This is a courtesy check before payment; the real guarantee against
    // overselling is the atomic reservation at the moment of actual payment.
    const product = await db.product.findUnique({ where: { id: po.productId } });
    if (product?.stockQuantity != null && po.quantity > product.stockQuantity) {
      const left = product.stockQuantity;
      const body = left > 0
        ? `Sorry — we only have ${left} ${po.productName} left right now. Would you like ${left} instead, or a different quantity?`
        : `Sorry — ${po.productName} is actually out of stock right now. Would you like something else, or should I let you know once it's back?`;
      return emit([{ body }], "awaiting_order_quantity", { pendingOrder: { ...po, quantity: 0 } });
    }
    // A short, warm heads-up once a few questions have stacked up in a row —
    // never let a genuinely-necessary chain of "never assume" questions start
    // to feel like an interrogation.
    const asked = po.questionsAsked ?? 0;
    const askPrefix = asked === 2 ? "I know that's a couple of questions in a row — just want to get this exactly right for you! " : asked >= 3 ? "Thanks for bearing with me, almost there — " : "";
    if (po.options && !po.optionChosen) {
      return emit([{ body: `${askPrefix}For ${po.productName}, which would you like — ${po.options}?` }], "awaiting_order_option", { pendingOrder: { ...po, questionsAsked: asked + 1 } });
    }
    if (!po.fulfillment) {
      return emit([{ body: `${askPrefix}Would you like this delivered, or will you pick it up yourself?` }], "awaiting_order_fulfillment", { pendingOrder: { ...po, questionsAsked: asked + 1 } });
    }
    if (po.fulfillment === "delivery" && !po.deliveryAddress) {
      return emit([{ body: `${askPrefix}What's the delivery address? Please be specific — area, street, and a landmark — so it actually gets to you.` }], "awaiting_order_address", { pendingOrder: { ...po, questionsAsked: asked + 1 } });
    }
    // Never assume the M-Pesa prompt should go to the number they're chatting
    // from — someone often orders from their own WhatsApp but pays from a
    // spouse's/shop till number. Ask explicitly, once, before the recap.
    if (!po.paymentPhone) {
      return emit([{ body: `${askPrefix}Which number should I send the M-Pesa payment request to — this number (${senderAddress}), or a different one?` }], "awaiting_order_payment_phone", { pendingOrder: { ...po, questionsAsked: asked + 1 } });
    }
    return emit([{ body: `Here's your order — please check it's right:\n${orderRecapText(po)}\n\nReply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }], "awaiting_order_confirm", { pendingOrder: po });
  };

  const text = input.text.trim();
  const lower = text.toLowerCase();
  // Hoisted here (was previously computed much later, right before its own
  // two call sites) after finding a THIRD branch that skipped it: the
  // awaiting_identify resume path (below) answers a non-ID-looking message
  // via smallTalk() directly, and since it runs long before the old
  // definition site, an escalation request landing while someone was mid-
  // onboarding got treated as small talk instead of creating a ticket —
  // the exact bug class already fixed twice before (see escalateToHuman's
  // own comment), just in a state that fix didn't reach. One canonical
  // definition, checked at every branch that can terminate the turn with
  // an AI-generated reply, closes the whole class instead of one instance.
  const isEscalationRequest = /(speak|talk).*(human|someone|agent|person)|human agent|customer care/.test(lower);

  // ── Super-app ACCESS MODEL ────────────────────────────────────────────────
  // A person RECOGNIZED by this organization (linked with a role — e.g. a
  // registered teacher/employee/parent) on an org with an active/paid P2Less
  // subscription gets tool use included, free, as part of what the org already
  // pays for. Anyone new/unrecognized — a walk-up, an unregistered teacher —
  // pays per use from their own credit wallet (topped up via M-Pesa).
  const orgSubActive = tenant.subscription ? ["active", "trial"].includes(tenant.subscription.status) : false;
  const recognizedFree = contact.contactRoles.length > 0 && orgSubActive;

  // ── Super-app: wallet top-up — "pay", "pay 100", "topup 200" ────────────
  const payMatch = /^(pay|top\s?up|buy credits|add credits)\b\s*(\d+)?/i.exec(lower);
  if (payMatch) {
    const amountKes = Number(payMatch[2] ?? 100);
    if (amountKes < 10) {
      return emit([{ body: `The smallest top-up is KES 10 (≈ ${Math.floor(10 / creditRateKes())} credits). Reply *PAY 100* for example.` }], "open", ctx);
    }
    const res = await startTopup({ tenantId: tenant.id, contactId: contact.id, phone: senderAddress, amountKes });
    if (!res.ok) return emit([{ body: `Couldn't start that top-up: ${res.error}` }], "open", ctx);
    if (res.mock) {
      return emit([{ body: `✅ Added *${res.credits}* credits (demo mode — no real M-Pesa configured). New balance: *${res.newBalance}*.` }], "open", ctx);
    }
    return emit([{ body: `📲 ${res.customerMessage}\n\nOnce you enter your M-Pesa PIN, *${creditsForAmount(amountKes)}* credits will land in your wallet automatically.` }], "open", ctx);
  }

  // ── Super-app: a FILE was sent → run the matching tool ───────────────────
  // Handled before org onboarding/intent so ANY sender can use a tool without a
  // login — the super-app surface is universal; org-specific flows come after.
  if (input.attachment) {
    const tool = pickTool({ text, attachment: input.attachment });
    if (!tool) {
      return emit([{ body: "I got your file 📎 — right now I can analyze *spreadsheets* (send a CSV and I'll break down the trends and totals). More file types are on the way!" }], "open", ctx);
    }
    if (!recognizedFree && contact.credits < tool.cost) {
      return emit([{ body: `The *${tool.name}* tool costs ${tool.cost} credits, and you have ${contact.credits}. Reply *PAY 100* to top up KES 100 (≈ ${creditsForAmount(100)} credits) via M-Pesa and I'll get right on it. 💳` }], "open", ctx);
    }
    // Slow tools say what they're doing FIRST — sent as its own message, before
    // the (possibly several-second) real work starts, instead of long silence.
    if (tool.announce) await announceNow(tool.announce);
    const result = await tool.run({ text, attachment: input.attachment }, { assistant, contactName: contact.displayName ?? undefined });
    const replies: Reply[] = [{ body: result.reply }];
    if (result.document) replies.push({ kind: "document", body: `📄 ${result.document.filename}`, document: result.document });
    // Only charge when the tool did billable work — and never for a recognized,
    // covered member of a paying org (their subscription already covers this).
    if (!result.noCharge && !recognizedFree) {
      const remaining = contact.credits - tool.cost;
      await db.contact.update({ where: { id: contact.id }, data: { credits: remaining } });
      await meter(tenant.id, "tool_run");
      replies.push({ kind: "system", body: `— ${tool.cost} credits used · ${remaining} left`, meta: { credits: remaining } });
    } else if (!result.noCharge && recognizedFree) {
      await meter(tenant.id, "tool_run");
      replies.push({ kind: "system", body: `— included with ${assistant}'s plan ✓`, meta: { included: true } });
    }
    const nextCtx: ConvContext = result.remember ? { ...ctx, lastDocument: { label: result.remember.label, text: result.remember.text, ts: Date.now() } } : ctx;
    return emit(replies, "open", nextCtx);
  }

  // ── Super-app: wallet balance ───────────────────────────────────────────
  if (/^(balance|credits|my credits|how many credits|wallet)\b/i.test(lower)) {
    if (recognizedFree) {
      return emit([{ body: `You're a recognized member of ${assistant} — tool use is included in their plan, no credits needed. 🎉` }], "open", ctx);
    }
    return emit([{ body: `You have *${contact.credits}* credits. 💳 Send me a spreadsheet to analyze, or reply *PAY 100* to top up${mpesaConfigured() ? " via M-Pesa" : ""}.` }], "open", ctx);
  }

  // Is this message ONLY a greeting (no real request riding along)? Strip greeting
  // words and see if anything substantial remains. Used both to reset stale flows
  // and, later, to decide whether to show the welcome menu.
  const afterGreeting = lower
    .replace(/^((hi+|hey+|hello+|helloo+|yo|hiya|sasa|mambo|niaje|habari|jambo|good\s*(morning|afternoon|evening|day)|menu|help)[\s,!.]*)+/i, "")
    .trim();
  const pureGreeting = (isGreeting(text) || /^(menu|help|hi+|hey+|hello+)\b/.test(lower)) && afterGreeting.split(/\s+/).filter(Boolean).length <= 1;

  // ── Universal escape hatch: bail out of any pending flow on demand ───────
  if (conversation.status !== "open" && /^(cancel|stop|quit|exit|start over|start again|restart|main menu|menu)\b/i.test(lower)) {
    const m = numberedMenu(await loadActions(tenant.id));
    const body = contact.contactRoles.length === 0
      ? `No problem, let's start over. 👋`
      : `Okay, starting fresh. 👋${menuPrompt(m, "Reply with a number or just tell me what you need:")}`;
    return emit([{ body }], "open", { menu: contact.contactRoles.length === 0 ? undefined : m.ids });
  }

  // A plain "hello" in the middle of a half-finished write flow means the person
  // has moved on / is starting over — NOT an answer to "what date?". Reset the
  // stale flow and greet them, instead of nagging for a value they never asked
  // to provide. (OTP already falls through on its own; identify handles greetings.)
  if ((conversation.status === "awaiting_confirm" || conversation.status === "awaiting_param") && pureGreeting) {
    const menu = numberedMenu(await loadActions(tenant.id));
    const first = (contact.displayName ?? "").split(" ")[0];
    const hi = first
      ? `Good ${partOfDay()}, ${first}! 👋 Welcome back to ${assistant}.`
      : `Good ${partOfDay()}! 👋 ${branding.welcome ?? `Welcome to ${assistant}.`}`;
    return emit([{ body: `${hi}${menuPrompt(menu)}` }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
  }

  // ── Resume: awaiting OTP ────────────────────────────────────────────────
  // Forgiving: only treat the message as a code if it looks like one. A greeting,
  // a "resend", a "cancel", or a brand-new request all flow naturally instead of
  // being rejected as a wrong code.
  if (conversation.status === "awaiting_otp" && ctx.otpChallengeId) {
    const codeMatch = text.match(/\b(\d{4,8})\b/);
    if (/^(cancel|stop|quit|exit|start over|restart)\b/i.test(lower)) {
      return emit([{ body: "No problem — I've cancelled that. What would you like to do?" }], "open", { lastResource: ctx.lastResource });
    }
    // "where's the code / resend / didn't get it / send again" → issue a fresh code.
    // Defensive, not the primary guard: reaching "awaiting_otp" on the widget
    // channel at all should already be impossible now that both issuance
    // sites below are blocked — kept consistent in case that ever changes.
    if (!codeMatch && /(resend|new code|another code|where.*(code|is it)|did ?n.?t|have ?n.?t|not receiv|no code|send.*again|try again)/i.test(lower)) {
      if (input.channelType === "widget") {
        return emit([{ body: await widgetOtpBlockedMessage(tenant.id, "verify that") }], "open", { lastResource: ctx.lastResource });
      }
      const reissued = await issueOtp(tenant.id, contact.id);
      if ("error" in reissued) return emit([{ body: reissued.error }], "open", {});
      return emit([{ body: "No worries — here's a fresh code." }, ...buildOtpReplies(input.channelType, reissued.code, contact.displayName ?? undefined)], "awaiting_otp", { ...ctx, otpChallengeId: reissued.challengeId });
    }
    if (codeMatch) {
      const result = await verifyOtp(ctx.otpChallengeId, codeMatch[1]);
      if (!result.ok) {
        await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "otp.verify", success: false, detail: { reason: result.reason } });
        if (result.reason === "too_many" || result.reason === "expired") {
          return emit([{ body: `${result.message}` }], "open", { lastResource: ctx.lastResource });
        }
        return emit([{ body: result.message }], "awaiting_otp", ctx);
      }
      await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "otp.verify", success: true });
      // Case 1: OTP was the last step of self-service linking → link the account.
      if (ctx.pendingLink) {
        const pl = ctx.pendingLink;
        await linkContact(tenant.id, contact.id, { idLabel: "", grantKey: pl.grantKey, roleKey: pl.roleKey, office: "", audience: "" }, pl.personId, pl.name);
        await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "contact.link", target: pl.personId, success: true });
        const caps = numberedMenu(await loadActions(tenant.id));
        return emit([{ body: `✅ Verified — welcome, ${pl.name.split(" ")[0]}! Your number is now linked to ${assistant}.${menuPrompt(caps, "Reply with a number, or just ask:")}` }], "open", { menu: caps.ids });
      }
      // Case 2: OTP gated a sensitive action → resume it now.
      const resumed = await runAction({
        tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history,
        actionId: ctx.pendingActionId!, resolved: ctx.pendingResolved ?? {}, alreadyConfirmed: false,
        lastResource: ctx.lastResource, lastAction: ctx.lastAction,
      });
      return emit([{ body: "✓ Verification successful." }, ...resumed.replies], resumed.status, resumed.ctx);
    }
    // Not a code, not a command — the user has moved on. Drop out of OTP mode and
    // handle this message normally (greeting / new request below).
  }

  // ── Resume: awaiting confirmation (write actions) ───────────────────────
  if (conversation.status === "awaiting_confirm" && ctx.pendingActionId) {
    // Recognize natural SHORT yes/no replies ("ok confirm", "yes please", "go
    // ahead", "book it") — but a longer sentence that merely CONTAINS one of
    // these words in passing (e.g. "I need to confirm if my son arrived at
    // school") must NOT trigger a real write action on that false positive.
    const negateWords = /\b(cancel|no|nope|nah|don'?t|stop|nevermind|never mind|not now|forget it)\b/i;
    const affirmWords = /\b(confirm|ye(s|ah|p|a)|yup|ok|okay|sure|proceed|go ahead|do it|book it|go for it|please do|sounds good|looks good|that'?s (right|correct|good|fine))\b/i;
    // "sure" alone in affirmWords false-matches genuinely uncertain replies like
    // "not sure" / "I'm not sure" / "not really sure" — a negation immediately
    // before "sure"/"certain" means the person is NOT confirming, found live
    // while spot-checking the Phase 5 migration (2026-08-20).
    const NEGATED_UNCERTAIN = /\bnot\s+(really\s+)?(sure|certain)\b|\bn['’]t\s+(really\s+)?(sure|certain)\b/i;
    const negate = isDirectReply(lower, negateWords);
    const affirm = isDirectReply(lower, affirmWords) && !NEGATED_UNCERTAIN.test(lower);
    if (negate) {
      return emit([{ body: "No problem — I've cancelled that. Anything else I can help with?" }], "open", { lastResource: ctx.lastResource });
    }
    if (affirm) {
      const resumed = await runAction({
        tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history,
        actionId: ctx.pendingActionId, resolved: ctx.pendingResolved ?? {}, alreadyConfirmed: true,
        lastResource: ctx.lastResource, lastAction: ctx.lastAction,
      });
      return emit(resumed.replies, resumed.status, resumed.ctx);
    }
    // Don't robotically repeat "reply CONFIRM". The user might change their mind,
    // ask something else, or just chat. Follow a genuine new request; otherwise
    // answer naturally and then remind them the booking is still waiting.
    // Universal Platform roadmap Phase 5 migration (2026-08-20) — same
    // reroute/pushback/reask/abandon shape as awaiting_param and
    // awaiting_resource_pick, via evaluateWorkflowAsk(). Threshold stays at
    // this flow's existing 0.6 (higher than awaiting_param's 0.55) — a
    // payment/write-adjacent confirmation is more expensive to abandon on a
    // false reroute than a still-collecting slot fill. See docs/PHASE5-
    // WORKFLOW-ENGINE-SUBROADMAP-2026-08-19.md.
    const actionsNow = await loadActions(tenant.id);
    const reroute = await understand(text, actionsNow, history);
    const decision = evaluateWorkflowAsk(
      { plausibleAnswer: false, rerouteConfident: !!reroute.actionId && reroute.score >= 0.6 && reroute.actionKey !== ctx.pendingActionKey, isPushback: PUSHBACK.test(lower), asidesSoFar: ctx.paramAsides ?? 0 },
      { rerouteThreshold: 0.6 },
    );
    if (decision.kind === "reroute" && reroute.actionId) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
      return emit(run.replies, run.status, run.ctx);
    }
    const stc = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
    if (decision.kind === "abandon") {
      return emit([{ body: stc ?? "No problem — I've set that aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
    }
    const remind = "Whenever you're ready, reply CONFIRM to go ahead, or CANCEL to drop it.";
    return emit([{ body: stc ? `${stc}\n\n${remind}` : `Please reply CONFIRM to proceed, or CANCEL to stop.` }], "awaiting_confirm", { ...ctx, paramAsides: decision.kind === "reask" ? decision.asidesSoFar : ctx.paramAsides });
  }

  // ── Resume: a "which student/employee/patient do you mean?" list is pending —
  // a bare number or the name must resume the ORIGINAL action with that
  // resource, not be reprocessed as a brand-new message (a real, previously
  // broken bug: it just re-triggered the same ambiguous match and repeated the
  // identical question forever, no matter what number was picked). ──────────
  if (conversation.status === "awaiting_resource_pick" && ctx.pendingDisambiguation) {
    const pd = ctx.pendingDisambiguation;
    if (/^(cancel|stop|nevermind|never mind)$/i.test(lower)) {
      return emit([{ body: "No problem, I've cancelled that." }], "open", { lastResource: ctx.lastResource });
    }
    const numMatch = /^\s*(\d{1,2})\s*$/.exec(text);
    const picked = numMatch ? pd.candidates[parseInt(numMatch[1], 10) - 1] : pd.candidates.find((c) => c.name.toLowerCase().includes(lower.trim()) || lower.trim().includes(c.name.toLowerCase()));
    if (picked) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, pd.actionId, { ...pd.entities, name: picked.name }, { lastResource: ctx.lastResource, lastAction: ctx.lastAction });
      return emit(run.replies, run.status, run.ctx);
    }
    // Universal Platform roadmap Phase 5 pilot migration (2026-08-20) — this
    // handler previously had NO escape besides an exact "cancel": any message
    // that wasn't a valid pick just repeated "Sorry, just reply with the
    // number" forever, unlike every other awaiting_* handler (which all
    // follow a genuine topic switch or abandon after repeated stray
    // messages). Closes that gap using evaluateWorkflowAsk() — the first
    // real caller of the Phase 5 primitive, now that the port-mismatch fix
    // (2026-08-20 earlier) restored a full local regression safety net
    // (scripts/test.ts hits 73/73 clean) to verify this against.
    const actionsNow = await loadActions(tenant.id);
    const reroute = await understand(text, actionsNow, history);
    // 0.55, matching awaiting_param's threshold rather than awaiting_confirm's
    // 0.6 — nothing has executed yet at this point (just a pending disambiguation),
    // so abandoning it for a confident reroute is cheaper to get wrong than
    // abandoning an already-collected write action.
    const decision = evaluateWorkflowAsk(
      { plausibleAnswer: false, rerouteConfident: !!reroute.actionId && reroute.score >= 0.55, isPushback: PUSHBACK.test(lower), asidesSoFar: ctx.paramAsides ?? 0 },
      { rerouteThreshold: 0.55 },
    );
    if (decision.kind === "reroute" && reroute.actionId) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
      return emit(run.replies, run.status, run.ctx);
    }
    if (decision.kind === "abandon") {
      const stc = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
      return emit([{ body: stc ?? "No problem — I've set that aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
    }
    const list = pd.candidates.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    return emit([{ body: `Sorry, just reply with the number: \n${list}` }], "awaiting_resource_pick", { ...ctx, paramAsides: decision.kind === "reask" ? decision.asidesSoFar : ctx.paramAsides });
  }

  // ── Resume: collecting a missing parameter (multi-step slot filling) ─────
  if (conversation.status === "awaiting_param" && ctx.pendingActionId && ctx.missingParam) {
    if (/^(cancel|stop|nevermind|never mind)$/i.test(lower)) {
      return emit([{ body: "No problem, I've cancelled that." }], "open", { lastResource: ctx.lastResource });
    }
    const expected = ctx.missingEntity ?? ctx.missingParam;
    // People don't stay on rails — they change their mind or ask something else
    // mid-flow. Decide whether THIS message is the answer we asked for, or a new
    // topic. If it doesn't look like a plausible answer, see if it's a different
    // request and follow it, instead of forcing it into the slot.
    const plausibleAnswer =
      expected === "date" || expected === "startDate" || expected === "endDate" ? !!extractDate(text)
      : expected === "time" ? !!extractTime(text)
      : expected === "reason" ? !isGreeting(text) && !/\?\s*$/.test(text)
      : true;
    if (!plausibleAnswer) {
      const actionsNow = await loadActions(tenant.id);
      const collectBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      // A broad "tell me about her" → abandon this slot and give the overview.
      // Its own special resolution, unrelated to intent-scoring — checked
      // before the reroute/pushback ladder below, same position as always.
      if (isOverviewRequest(lower)) {
        const target = await resolveOverviewTarget(text, grants, tenant.id, ctx.lastResource);
        if (target && !("ask" in target)) {
          const ov = await runOverview(collectBase, target.grantKey, target.student);
          return emit(ov.replies, ov.status, ov.ctx);
        }
      }
      // Universal Platform roadmap Phase 5 migration (2026-08-20) — this flow
      // already had the full reroute/pushback/reask/abandon shape
      // evaluateWorkflowAsk() (workflow-engine.ts) was modeled on, unlike
      // the awaiting_resource_pick pilot (which had none of this and needed
      // real new behavior) — this migration is verified behaviorally
      // identical, not an enhancement. See docs/PHASE5-WORKFLOW-ENGINE-
      // SUBROADMAP-2026-08-19.md.
      const reroute = await understand(text, actionsNow, history);
      // Extra condition beyond the primitive's own inputs: a reroute to the
      // SAME pending action doesn't count as a genuine topic switch — folded
      // into rerouteConfident here rather than taught to the pure primitive.
      const decision = evaluateWorkflowAsk(
        { plausibleAnswer: false, rerouteConfident: !!reroute.actionId && reroute.score >= 0.55 && reroute.actionKey !== ctx.pendingActionKey, isPushback: PUSHBACK.test(lower), asidesSoFar: ctx.paramAsides ?? 0 },
        { rerouteThreshold: 0.55 },
      );
      if (decision.kind === "reroute" && reroute.actionId) {
        // Genuine topic switch → abandon the half-filled flow and follow them.
        const run = await dispatchAction(collectBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
        return emit(run.replies, run.status, run.ctx);
      }
      const st = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
      if (decision.kind === "abandon") {
        return emit([{ body: st ?? "No problem — I've set that aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
      }
      const reask = `${promptFor(expected)}\n\n(Or just say "cancel" if you didn't mean to start this.)`;
      return emit([{ body: st ? `${st}\n\n${reask}` : reask }], "awaiting_param", { ...ctx, paramAsides: decision.kind === "reask" ? decision.asidesSoFar : ctx.paramAsides });
    }
    const value = resolveEntityFromText(expected, text);
    const resolved = { ...(ctx.pendingResolved ?? {}), [ctx.missingParam]: value };
    // "next tuesday at 2pm" answers BOTH date and time — capture the OTHER
    // entity KIND present in the same message so we don't re-ask for what
    // they already gave. Deliberately cross-kind ONLY: a single date mention
    // must never also backfill a SECOND date-type slot (startDate/endDate
    // are both "date" kind but different slots) — real bug found + fixed
    // 2026-08-20 while extending extractDate() to parse "DD Month" dates:
    // that fix un-masked this, since a lone "20 August" for a leave request
    // previously never matched at all, so the flood into BOTH startDate and
    // endDate was invisible until extractDate() started succeeding. See
    // docs/PHASE5-WORKFLOW-ENGINE-SUBROADMAP-2026-08-19.md.
    const dateKinds = new Set(["date", "startDate", "endDate"]);
    const expectedKind = dateKinds.has(expected) ? "date" : expected === "time" ? "time" : null;
    const pAction = await db.connectorAction.findUnique({ where: { id: ctx.pendingActionId } });
    for (const spec of ((pAction?.paramSchema as unknown as ParamSpec[]) ?? [])) {
      if (spec.from !== "entity") continue;
      const ent = spec.entity ?? spec.name;
      if (resolved[spec.name] !== undefined && resolved[spec.name] !== "") continue;
      const entKind = dateKinds.has(ent) ? "date" : ent === "time" ? "time" : null;
      if (!entKind || entKind === expectedKind) continue; // never reuse this turn's extraction for a second same-kind slot
      if (entKind === "date") { const d = extractDate(text); if (d) resolved[spec.name] = d; }
      else { const t = extractTime(text); if (t) resolved[spec.name] = t; }
    }
    const run = await continueCollection(
      { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history },
      ctx.pendingActionId,
      resolved,
      ctx.lastResource,
    );
    return emit(run.replies, run.status, run.ctx);
  }

  // ── Resume: self-service identification (unknown user gave their ID) ─────
  if (conversation.status === "awaiting_identify") {
    // The contact may have been linked in the meantime by someone/something else
    // (office staff, a backend fix) while this conversation was still sitting in
    // "awaiting_identify" — that status is now STALE. Don't keep asking for an ID
    // that's no longer needed; drop into the normal recognized-contact flow.
    if (contact.contactRoles.length > 0) {
      return emit([{ body: `Good news — you're already connected! 🎉 What can I help you with?` }], "open", {});
    }
    // Real bug found live-testing 2026-08-23: an unlinked contact asking to
    // talk to a human while mid-onboarding fell straight into the
    // "not an ID attempt → smallTalk()" branch below, with a real AI-
    // generated decline ("I'm the AI assistant... contact the office
    // directly") instead of ever creating a ticket — this state was missed
    // by both earlier escalation-check fixes since it runs before either.
    if (isEscalationRequest) return escalateToHuman(contact, conversation);
    if (/^(cancel|stop|no|nevermind|never mind)$/i.test(lower)) {
      return emit([{ body: "No problem — say “hi” whenever you'd like to get connected." }], "open", {});
    }
    const ob0 = onboardingFor(tenant.industry);
    // A greeting or "help" here means re-explain, not "that's a bad ID".
    if (ob0 && (isGreeting(text) || /^help\b/.test(lower))) {
      return emit([{ body: `👋 To connect you, just reply with your ${ob0.idLabel} — the one ${ob0.office} has on file for you. Or reply CANCEL.` }], "awaiting_identify", {});
    }
    // A genuine message ("what are your fees", "hello how are you") is NOT
    // an ID attempt — don't force-fit it into executeAction() below and
    // repeat "couldn't match that ID" at someone saying something real.
    // FIRST FIX (2026-08-20) used looksLikeAQuestion() here, which only
    // catches "?" or a message STARTING with a question word — live-tested
    // by the user and found too narrow: "hello how are you" starts with
    // "hello", isn't a pure greeting (isGreeting caps at 3 words), and has
    // no "?", so it slipped through both checks into a failed ID-match.
    // CORRECTED to the inverse, more robust check: does this look like it
    // COULD be an ID at all? Default to "no" (answer it for real) for
    // anything ambiguous — the cost of wrongly treating a real message as a
    // failed ID attempt is worse than occasionally re-prompting for a
    // genuinely bad ID.
    if (ob0 && !looksLikeIdAttempt(text)) {
      const actionsNow = await loadActions(tenant.id);
      const st = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
      const remind = `\n\nWhenever you're ready, reply with your ${ob0.idLabel} to connect your account for personalized help.`;
      return emit([{ body: (st ?? "Happy to help — what would you like to know?") + remind }], "awaiting_identify", {});
    }
    const ob = onboardingFor(tenant.industry);
    const identify = await db.connectorAction.findFirst({ where: { key: "IDENTIFY", connector: { tenantId: tenant.id, status: "active" } } });
    if (!ob || !identify) {
      return emit([{ body: "Thanks — someone from our team will help you get set up." }], "open", {});
    }
    const res = await executeAction(identify.id, { id: text.trim(), phone: senderAddress });
    if (res.ok && res.data.matched === true) {
      const name = String(res.data.name ?? "there");
      const personId = String(res.data.personId ?? text.trim());
      // Second factor: send a one-time code before linking, so a known ID alone
      // isn't enough — the person must also receive the code on this number.
      // Website widget (Phase 8e, 2026-08-20): blocked by explicit user
      // decision, live-testing found the widget has no real second channel to
      // deliver a code to — a code would just be echoed back in the same HTTP
      // response, proving nothing. Never silently weaken this to a "demo
      // hint" the way the internal webchat simulator does; decline honestly
      // instead, until a real secondary delivery channel is built.
      if (input.channelType === "widget") {
        return emit([{ body: await widgetOtpBlockedMessage(tenant.id, "link your account") }], "open", {});
      }
      const issued = await issueOtp(tenant.id, contact.id);
      if ("error" in issued) return emit([{ body: issued.error }], "open", {});
      await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "otp.issue", target: "link", success: true });
      const replies: Reply[] = [{ body: `Almost there, ${name.split(" ")[0]}! Let's confirm it's really you.` }, ...buildOtpReplies(input.channelType, issued.code)];
      return emit(replies, "awaiting_otp", { otpChallengeId: issued.challengeId, pendingLink: { grantKey: ob.grantKey, roleKey: ob.roleKey, personId, name } });
    }
    await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "contact.link", success: false });
    return emit([{ body: `Hmm, I couldn't match that ${ob.idLabel} to this phone number. Please double-check it and try again, or contact ${ob.office} to get linked. (Reply CANCEL to stop.)` }], "awaiting_identify", {});
  }

  // ── Super-app: CV writer — universal, works for anyone (like the file tools) ─
  // A CV isn't collected via rigid one-field-at-a-time slot filling (too tedious
  // over chat); instead we accumulate whatever the person tells us across turns
  // and let the AI decide once it's genuinely enough to produce something real.
  const CV_COST = 4;
  const CV_EDIT_COST = 1;
  // Never ask for what we already know from the conversation itself — the
  // sender's own phone number, and their name if this is a recognized contact.
  const cvKnownFacts = `Known already — use this, do not ask for it again: their WhatsApp/phone number is ${senderAddress}.${contact.displayName ? ` Their name is ${contact.displayName}.` : ""}`;
  const tryBuildCv = async (rawText: string, isEdit: boolean, asides = 0): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> => {
    const extraction = await extractCvData(`${cvKnownFacts}\n${rawText}`);
    if (!extraction.sufficient) {
      const ask = extraction.missing.map((m) => `• ${m}`).join("\n");
      // First ask: the plain checklist + a concrete example. From the 2nd try
      // onward, don't repeat the identical text — acknowledge what they said
      // (they may be confused, asking a question, or pushing back) and rephrase.
      let body: string;
      if (asides === 0) {
        body = `Almost there! Could you also share:\n${ask}\n\nFor example: "I'm Jane Wanjiru. I worked at ABC Ltd as an Accountant from 2020 to 2023, and studied a Diploma in Business at XYZ College 2017–2019."\n\n(Or reply CANCEL to stop.)`;
      } else {
        const st = aiEnabled() ? await smallTalk(assistant, text, [], history, knownFacts, orgFaqs) : null;
        const plain = `Still need:\n${ask}\n\nJust describe it in your own words in one message — I'll handle the formatting. Or reply CANCEL if you'd rather not right now.`;
        body = st ? `${st}\n\n${plain}` : plain;
      }
      return { replies: [{ body }], status: "awaiting_cv_details", ctx: { cvBuilder: { rawText, asides } } };
    }
    const cost = isEdit ? CV_EDIT_COST : CV_COST;
    if (!recognizedFree && contact.credits < cost) {
      return {
        replies: [{ body: `${isEdit ? "Updating your CV" : "Your CV is ready to generate"} costs ${cost} credit${cost === 1 ? "" : "s"}, and you have ${contact.credits}. Reply *PAY 100* to top up (≈ ${creditsForAmount(100)} credits) and I'll finish it right away. 💳` }],
        status: "awaiting_cv_details",
        ctx: { cvBuilder: { rawText } },
      };
    }
    await announceNow(isEdit ? "📝 Updating your CV now..." : "📝 Great, I have what I need — putting your professional CV together now...");
    const doc = await generateCvPdf({ tenantId: tenant.id, contactId: contact.id, data: extraction.data });
    const replies: Reply[] = [
      { body: isEdit
        ? `✅ Updated! Here's your revised CV. Let me know if there's anything else to change.`
        : `✅ Here's your CV, ${extraction.data.name.split(" ")[0]}! Let me know if you'd like anything changed — more detail on a role, a different summary, whatever you need — I'll remember what we've got.` },
      { kind: "document", body: `📄 ${doc.filename}`, document: doc },
    ];
    if (!recognizedFree) {
      const remaining = contact.credits - cost;
      await db.contact.update({ where: { id: contact.id }, data: { credits: remaining } });
      replies.push({ kind: "system", body: `— ${cost} credit${cost === 1 ? "" : "s"} used · ${remaining} left`, meta: { credits: remaining } });
    } else {
      replies.push({ kind: "system", body: `— included with ${assistant}'s plan ✓`, meta: { included: true } });
    }
    await meter(tenant.id, "tool_run");
    // Keep the data around (not reset) — so a later "also add X" can amend it
    // without starting over or, worse, an AI claiming to update something it
    // has no memory of.
    return { replies, status: "open", ctx: { cvBuilder: { rawText } } };
  };

  if (conversation.status === "awaiting_cv_details") {
    if (/^(cancel|stop|nevermind|never mind)$/i.test(lower)) {
      return emit([{ body: "No problem, we can pick it back up anytime — just say \"write my CV\" again." }], "open", {});
    }
    const combined = `${ctx.cvBuilder?.rawText ?? ""}\n${text}`.trim();
    const run = await tryBuildCv(combined, false, (ctx.cvBuilder?.asides ?? 0) + 1);
    return emit(run.replies, run.status, run.ctx);
  }
  if (isCvRequest(lower)) {
    const combined = ctx.cvBuilder?.rawText ? `${ctx.cvBuilder.rawText}\n${text}` : text;
    const run = await tryBuildCv(combined, !!ctx.cvBuilder);
    return emit(run.replies, run.status, run.ctx);
  }
  // A CV already exists in this conversation and this message looks like an
  // amendment to it ("also add...", "change my...", "remove...") even without
  // saying "CV" again — append it and regenerate, rather than silently doing
  // nothing (or worse, an AI claiming falsely that it updated something).
  // Excludes obvious org-domain wording so it doesn't hijack e.g. "change my
  // appointment" just because a CV happened to be built earlier in this chat.
  const looksOrgDomain = /\b(fee|balance|attendance|appointment|meeting|exam|results?|leave|payslip|salary|school|student|class|grade)\b/i.test(lower);
  if (ctx.cvBuilder && !looksOrgDomain && /\b(add|also|include|update|change|edit|fix|remove|correct|redo|regenerate)\b.{0,30}\b(my|i|cv|resume|résumé)\b|\b(my|i)\b.{0,15}\b(add|also|include|update|change|remove|correct)\b/i.test(lower)) {
    const combined = `${ctx.cvBuilder.rawText}\n${text}`;
    const run = await tryBuildCv(combined, true);
    return emit(run.replies, run.status, run.ctx);
  }

  // ── Super-app: business catalog — browse + order a tenant's own products ────
  // Native P2Less data (not a connector), tenant-scoped by the SAME routing
  // already used everywhere (destination number → tenant). Universal like the
  // file tools and CV writer — works for anyone messaging this number.

  // Universal Platform roadmap Phase 5, order-flow slice (2026-08-20,
  // user-approved scope after live-reading the actual code showed these 6
  // states DON'T share awaiting_confirm/awaiting_param's shape — there was no
  // reroute/pushback/abandon here at all; a non-answer just re-asked the same
  // question forever, the exact robotic-re-nagging class of bug fixed
  // everywhere else in this file. Shared by the 5 slot-filling order states
  // (NOT awaiting_order_confirm, which keeps its own inline ladder below,
  // money-adjacent 0.6 threshold matching awaiting_confirm's). Called only
  // AFTER the existing resolveOrderStepAnswer() attempt fails to resolve the
  // message as an answer to the specific question being asked — this adds
  // reroute/pushback/abandon on top of that, doesn't replace it.
  const orderAskLadder = async (
    status: "awaiting_order_quantity" | "awaiting_order_option" | "awaiting_order_fulfillment" | "awaiting_order_address" | "awaiting_order_payment_phone",
    reaskBody: string,
  ) => {
    const actionsNow = await loadActions(tenant.id);
    const reroute = await understand(text, actionsNow, history);
    const decision = evaluateWorkflowAsk(
      { plausibleAnswer: false, rerouteConfident: !!reroute.actionId && reroute.score >= 0.55, isPushback: PUSHBACK.test(lower), asidesSoFar: ctx.paramAsides ?? 0 },
      { rerouteThreshold: 0.55 },
    );
    if (decision.kind === "reroute" && reroute.actionId) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
      return emit(run.replies, run.status, run.ctx);
    }
    if (decision.kind === "abandon") {
      return emit([{ body: "No problem — I've set that order aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
    }
    return emit([{ body: reaskBody }], status, { ...ctx, paramAsides: decision.kind === "reask" ? decision.asidesSoFar : ctx.paramAsides });
  };

  if (conversation.status === "awaiting_order_quantity" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    if (isDirectReply(lower, /\b(cancel|no|nope|nah|stop|don'?t)\b/i)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (!hasExplicitQuantity(text) || looksLikeAQuestion(text)) {
      // Didn't recognize a number by the fast check — OR it has a number but is
      // still phrased as a question ("do you have 2 in stock" is NOT "I want
      // 2"). Before just repeating the same line, let the AI actually read what
      // they said (another language, a word-number, or a real question) rather
      // than assume it's unclear, or worse, misread a question as an answer.
      if (aiEnabled()) {
        const resolved = await resolveOrderStepAnswer({
          assistant, question: `how many ${po.productName} they'd like (a number)`, userText: text, history,
          knownFacts: await productKnownFacts(po),
        });
        if (resolved.answered) {
          const n = parseInt(resolved.value.replace(/[^\d]/g, ""), 10);
          if (n > 0) return advanceOrder({ ...po, quantity: n });
        } else if (resolved.reply) {
          return orderAskLadder("awaiting_order_quantity", resolved.reply);
        }
      }
      const attrInfo = await productAttributeFallback(po, lower);
      return orderAskLadder("awaiting_order_quantity", attrInfo ? `${attrInfo} And how many ${po.productName} would you like?` : `Sorry, how many ${po.productName} would you like? (Just the number, e.g. "2")`);
    }
    const qty = extractQuantity(text);
    return advanceOrder({ ...po, quantity: qty });
  }
  if (conversation.status === "awaiting_order_option" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    if (isDirectReply(lower, /\b(cancel|no|nope|nah|stop|don'?t)\b/i)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    // Any real, non-empty answer counts — this is free text (color/size/etc.),
    // not something we can validate against a fixed list, so just make sure it
    // isn't a stray greeting or an unrelated question riding along. A "?" alone
    // is NOT enough to detect a question — "which one is available" has none.
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 100 || looksLikeAQuestion(trimmed)) {
      if (aiEnabled()) {
        const resolved = await resolveOrderStepAnswer({
          assistant, question: `which option they want for ${po.productName} (choices: ${po.options})`, userText: text, history,
          knownFacts: await productKnownFacts(po),
        });
        if (resolved.answered) return advanceOrder({ ...po, optionChosen: resolved.value });
        if (resolved.reply) return orderAskLadder("awaiting_order_option", resolved.reply);
      }
      return orderAskLadder("awaiting_order_option", `Sorry, just to be clear — for ${po.productName}, which would you like? (${po.options})`);
    }
    return advanceOrder({ ...po, optionChosen: trimmed });
  }
  if (conversation.status === "awaiting_order_fulfillment" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    if (isDirectReply(lower, /\b(cancel|no|nope|nah|stop|don'?t)\b/i) && !isPickupIntent(lower) && !isDeliveryIntent(lower)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (isDeliveryIntent(lower) && !isPickupIntent(lower)) {
      return advanceOrder({ ...po, fulfillment: "delivery" });
    }
    if (isPickupIntent(lower) && !isDeliveryIntent(lower)) {
      return advanceOrder({ ...po, fulfillment: "pickup" });
    }
    // The fast keyword check didn't recognize either — let the AI read it
    // properly (word forms it doesn't catch, another language, or a real
    // question) instead of assuming it's unclear and repeating itself.
    if (aiEnabled()) {
      const resolved = await resolveOrderStepAnswer({
        assistant, question: `whether they want ${po.productName} delivered, or will pick it up themselves — answer must be exactly "delivery" or "pickup"`, userText: text, history,
        knownFacts: await productKnownFacts(po),
      });
      if (resolved.answered) {
        const v = resolved.value.toLowerCase();
        if (v.includes("deliver")) return advanceOrder({ ...po, fulfillment: "delivery" });
        if (v.includes("pick")) return advanceOrder({ ...po, fulfillment: "pickup" });
      } else if (resolved.reply) {
        return orderAskLadder("awaiting_order_fulfillment", resolved.reply);
      }
    }
    // Ambiguous or unrelated reply — ask again rather than guessing either way.
    // If it was actually a product-attribute question (size/color/etc.), answer
    // it first — deterministically, so an AI outage never leaves it unanswered.
    const attrInfo = await productAttributeFallback(po, lower);
    return orderAskLadder("awaiting_order_fulfillment", attrInfo ? `${attrInfo} Now, would you like ${po.productName} delivered to you, or will you pick it up yourself?` : `Sorry — just to confirm, would you like ${po.productName} delivered to you, or will you pick it up yourself?`);
  }
  if (conversation.status === "awaiting_order_address" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    if (isDirectReply(lower, /\b(cancel|no|nope|nah|stop|don'?t)\b/i)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (!isAddressDetailed(text) || looksLikeAQuestion(text)) {
      // Either too short/vague to be a real address, OR phrased as a question
      // ("why do you need it", no "?" required) — a word-count check alone
      // can't tell those apart, so a real question gets a real answer instead
      // of being wrongly accepted as an address.
      if (looksLikeAQuestion(text) && aiEnabled()) {
        const resolved = await resolveOrderStepAnswer({
          assistant, question: `their delivery address (area, street, and a landmark)`, userText: text, history,
          knownFacts: await productKnownFacts(po),
        });
        if (resolved.answered) {
          if (isAddressDetailed(resolved.value)) {
            const zones = await db.deliveryZone.findMany({ where: { tenantId: tenant.id, active: true } });
            const zone = matchDeliveryZone(resolved.value, zones);
            return advanceOrder({ ...po, deliveryAddress: resolved.value, deliveryFee: zone?.fee, deliveryZoneName: zone?.name });
          }
        } else if (resolved.reply) {
          return orderAskLadder("awaiting_order_address", resolved.reply);
        }
      }
      const attrInfo = await productAttributeFallback(po, lower);
      return orderAskLadder("awaiting_order_address", attrInfo ? `${attrInfo} Now, could you share the delivery address — area, street, and a landmark nearby — so it actually finds you?` : `Could you share a bit more detail — area, street, and a landmark nearby — so the delivery actually finds you?`);
    }
    const address = text.trim();
    const zones = await db.deliveryZone.findMany({ where: { tenantId: tenant.id, active: true } });
    const zone = matchDeliveryZone(address, zones);
    return advanceOrder({ ...po, deliveryAddress: address, deliveryFee: zone?.fee, deliveryZoneName: zone?.name });
  }
  if (conversation.status === "awaiting_order_payment_phone" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    // Deliberately excludes a bare "no" here — after "this number or a
    // different one?", a bare "no" almost always means "not this one, let me
    // give another" rather than "cancel the whole order".
    if (isDirectReply(lower, /\b(cancel|stop|don'?t want|forget it)\b/i)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (isDirectReply(lower, /\b(this (one|number)|same( one| number)?|yes|yeah|yep|ok|okay|use this|my number|this)\b/i)) {
      return advanceOrder({ ...po, paymentPhone: senderAddress });
    }
    const phoneMatch = text.match(/(?:\+?254|0)\d{9}\b|\+\d{9,12}\b/);
    if (phoneMatch) {
      return advanceOrder({ ...po, paymentPhone: normalizePhone(phoneMatch[0]) });
    }
    if (aiEnabled()) {
      const resolved = await resolveOrderStepAnswer({
        assistant, question: `which phone number to send the M-Pesa payment request to — their current number (${senderAddress}), or a different number they'll type out`, userText: text, history,
        knownFacts: await productKnownFacts(po),
      });
      if (resolved.answered) {
        const v = resolved.value.toLowerCase();
        if (/this|same|current|my (own )?number/.test(v) && !/\d{7,}/.test(v)) {
          return advanceOrder({ ...po, paymentPhone: senderAddress });
        }
        const m = resolved.value.match(/(?:\+?254|0)\d{9}\b|\+\d{9,12}\b/);
        if (m) return advanceOrder({ ...po, paymentPhone: normalizePhone(m[0]) });
      } else if (resolved.reply) {
        return orderAskLadder("awaiting_order_payment_phone", resolved.reply);
      }
    }
    const attrInfo = await productAttributeFallback(po, lower);
    return orderAskLadder("awaiting_order_payment_phone", attrInfo ? `${attrInfo} Now, should I send the M-Pesa payment request to this number (${senderAddress}), or would you like to give a different one?` : `Sorry — just to confirm, should I send the M-Pesa payment request to this number (${senderAddress}), or would you like to give a different one?`);
  }
  if (conversation.status === "awaiting_order_confirm" && ctx.pendingOrder) {
    // This gates a REAL money charge — a false positive here means firing an
    // unintended M-Pesa payment prompt. Requires a short, direct reply, not
    // just "the word confirm/pay appears somewhere in a longer sentence"
    // (e.g. "I need to confirm if my son arrived at school" is a real question
    // about something else entirely, not authorization to buy anything).
    const negateWords = /\b(cancel|no|nope|nah|stop|don'?t)\b/i;
    const affirmWords = /\b(confirm|ye(s|ah|p)|yup|ok|okay|proceed|go ahead|pay|do it)\b/i;
    const negate = isDirectReply(lower, negateWords);
    const affirm = isDirectReply(lower, affirmWords);
    if (negate) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (affirm) {
      const po = ctx.pendingOrder;
      const total = orderGrandTotal(po);
      const reference = "ORD-" + randomToken(4).toUpperCase();
      const isDelivery = po.fulfillment === "delivery";
      const order = await db.order.create({
        data: {
          tenantId: tenant.id, contactId: contact.id, reference, totalAmount: total, currency: po.currency, status: "pending",
          fulfillment: po.fulfillment ?? "pickup", deliveryAddress: isDelivery ? po.deliveryAddress ?? null : null,
          deliveryFee: isDelivery ? po.deliveryFee ?? 0 : 0, deliveryZoneName: isDelivery ? po.deliveryZoneName ?? null : null,
          items: { create: [{ productId: po.productId, quantity: po.quantity, unitPrice: po.unitPrice, name: po.productName, optionChosen: po.optionChosen ?? null }] },
        },
      });
      // Reserved NOW, atomically, before any payment attempt — the earliest
      // possible moment — so two customers can never both be told "yes we have
      // it" for the last unit. If Daraja later reports this payment failed, the
      // callback route releases the hold back (see mpesa/callback/route.ts).
      const reserved = await reserveStock(po.productId, po.quantity);
      if (!reserved.ok) {
        await db.order.delete({ where: { id: order.id } });
        const body = reserved.available > 0
          ? `Sorry — someone just bought the last of those and only ${reserved.available} ${po.productName} are left now. Would you like ${reserved.available} instead, or something else?`
          : `Sorry — ${po.productName} just sold out. Would you like something else, or should I let you know once it's back?`;
        return emit([{ body }], "awaiting_order_quantity", { pendingOrder: { ...po, quantity: 0 } });
      }
      const payPhone = po.paymentPhone ?? senderAddress;
      const res = await startOrderPayment({ tenantId: tenant.id, orderId: order.id, phone: payPhone, amountKes: total, reference });
      if (!res.ok) {
        // The stock hold was never consumed — release it back rather than
        // leaving it permanently short by a unit nobody actually bought.
        await db.product.update({ where: { id: po.productId }, data: { stockQuantity: { increment: po.quantity } } }).catch(() => {});
        return emit([{ body: `Couldn't start payment: ${res.error}. Reply CONFIRM to try again, or CANCEL to stop.` }], "awaiting_order_confirm", ctx);
      }
      if (res.mock) {
        // Mock marks the order paid immediately (unlike real STK, which only
        // confirms asynchronously) — so this is the right moment to start
        // looking for a driver, same rule as the real-payment path: never
        // before payment is actually confirmed.
        if (isDelivery) {
          const trip = await db.deliveryTrip.create({ data: { tenantId: tenant.id, orderId: order.id, status: "searching" } });
          void tryAssignTrip(trip.id).catch(() => {});
        }
        const lastOrder: ConvContext["lastOrder"] = { reference, productName: po.productName, quantity: po.quantity, total, currency: po.currency, phone: payPhone, status: "paid" };
        const driverNote = isDelivery ? " Looking for a driver now — I'll update you as soon as one is confirmed." : "";
        return emit([{ body: `✅ Payment received (demo mode — no real M-Pesa configured)! Order ${reference} confirmed: ${po.quantity} × ${po.productName}. Thank you! 🎉${driverNote}` }], "open", { lastOrder });
      }
      // Keep this order in context (NOT wiped to {}) so an immediate follow-up
      // question ("which number did you send it to?") can be answered from real
      // data — without this the AI has nothing to go on and denies the order
      // ever happened, which is exactly the kind of hallucination we must avoid.
      const lastOrder: ConvContext["lastOrder"] = { reference, productName: po.productName, quantity: po.quantity, total, currency: po.currency, phone: payPhone, status: "pending_payment" };
      return emit([{ body: `📲 ${res.customerMessage}\n\nOnce you enter your M-Pesa PIN, I'll confirm order ${reference} right away.` }], "open", { lastOrder });
    }
    // Not a plain yes/no — they might be adjusting the order ("I need 5 of
    // them", "make it 3") rather than confirming/cancelling. Handle that
    // directly instead of ignoring it and robotically repeating CONFIRM/CANCEL.
    const po = ctx.pendingOrder;
    const qtyMatch = /\b(\d+)\b/.exec(text);
    if (qtyMatch && /\b(need|want|make it|change|actually|instead|of them|of it|please)\b/i.test(lower)) {
      const newQty = Math.max(1, parseInt(qtyMatch[1], 10));
      const updated = { ...po, quantity: newQty };
      return emit(
        [{ body: `Updated:\n${orderRecapText(updated)}\n\nReply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }],
        "awaiting_order_confirm",
        { pendingOrder: updated },
      );
    }
    // Universal Platform roadmap Phase 5, order-flow slice (2026-08-20,
    // user-approved scope) — this gates a REAL M-Pesa charge, so the reroute
    // threshold matches awaiting_confirm's own money-adjacent 0.6 (higher
    // than the 0.55 used by the slot-filling states above and by
    // orderAskLadder), not blindly reused from that shared helper.
    const actionsNow = await loadActions(tenant.id);
    const reroute = await understand(text, actionsNow, history);
    const decision = evaluateWorkflowAsk(
      { plausibleAnswer: false, rerouteConfident: !!reroute.actionId && reroute.score >= 0.6, isPushback: PUSHBACK.test(lower), asidesSoFar: ctx.paramAsides ?? 0 },
      { rerouteThreshold: 0.6 },
    );
    if (decision.kind === "reroute" && reroute.actionId) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
      return emit(run.replies, run.status, run.ctx);
    }
    const stc = aiEnabled() ? await smallTalk(assistant, text, [], history, knownFacts, orgFaqs) : null;
    if (decision.kind === "abandon") {
      return emit([{ body: stc ?? "No problem — I've set that order aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
    }
    const remind = `${orderRecapText(po)}\n\nReply CONFIRM to pay via M-Pesa, or CANCEL to stop.`;
    return emit([{ body: stc ? `${stc}\n\n${remind}` : remind }], "awaiting_order_confirm", { ...ctx, paramAsides: decision.kind === "reask" ? decision.asidesSoFar : ctx.paramAsides });
  }
  // A driver just reported this delivery as complete (see dispatch.ts) — the
  // customer's very next message is their real account of how it went, real
  // accountability data for the driver, never inferred.
  if (conversation.status === "awaiting_delivery_feedback") {
    if (ctx.awaitingFeedbackTripId) await db.deliveryTrip.updateMany({ where: { id: ctx.awaitingFeedbackTripId }, data: { customerFeedback: text.trim() } });
    return emit([{ body: "Thanks so much for letting us know — really appreciate it! 🙏" }], "open", {});
  }
  // ── Commerce intent — AI-FIRST. Typo/language-tolerant (handles Swahili,
  // Sheng, shorthand, "how much is X" vs an order, etc.) and grounded ONLY to
  // this tenant's real catalog — the AI is given the exact product list and
  // told to say "none" rather than guess. Keyword regexes are kept ONLY as the
  // fallback when AI is unavailable, same convention as understand() above.
  // This replaced a keyword-only version that produced real, reported bugs:
  // "how much is X" read as an order, "do you have paybill" dumping the
  // catalog, and Swahili messages never being understood as commerce at all. ──
  {
    // Deliberately includes out-of-stock products too — a customer asking
    // about one BY NAME should be told honestly that it's out of stock, not
    // get a non-answer just because it was silently excluded from the list.
    const catalogProducts = await db.product.findMany({ where: { tenantId: tenant.id, active: true, inStock: true } });
    if (catalogProducts.length > 0) {
      const intent: CommerceIntent = aiEnabled()
        ? await classifyCommerceMessage(text, catalogProducts.map((p) => ({ id: p.id, name: p.name })), history)
        : localCommerceIntent(lower, text, catalogProducts);

      if (intent.kind === "browse") {
        return emit([{ body: formatCatalog(assistant, catalogProducts) }], "open", ctx);
      }
      if (intent.kind === "image_question") {
        const withPhotos = catalogProducts.filter((p) => p.imageUrl);
        const hit = intent.productId ? catalogProducts.find((p) => p.id === intent.productId) : undefined;
        if (hit?.imageUrl) {
          return emit([{ body: `${hit.name} — ${hit.currency} ${hit.price.toLocaleString("en-US")}`, kind: "image", image: { url: hit.imageUrl }, meta: { url: hit.imageUrl } }], "open", ctx);
        }
        if (hit && !hit.imageUrl) {
          return emit([{ body: `We don't have a photo of ${hit.name} uploaded yet — happy to describe it, or ask about price and sizes!` }], "open", ctx);
        }
        if (withPhotos.length > 0) {
          return emit([{ body: `Sure — which one? We have photos of: ${withPhotos.map((p) => p.name).join(", ")}.` }], "open", ctx);
        }
        return emit([{ body: "We don't have photos of our products uploaded yet — happy to describe any of them, or you can ask about price, sizes, or anything else!" }], "open", ctx);
      }
      if (intent.kind === "price_question") {
        const hit = intent.productId ? catalogProducts.find((p) => p.id === intent.productId) : undefined;
        if (hit) {
          const parts = [`${hit.name} — ${hit.currency} ${hit.price.toLocaleString("en-US")}`];
          if (!isAvailable(hit)) parts.push("currently OUT OF STOCK");
          else if (isStockQuestion(lower)) {
            // Real number only — a product with untracked stock (null) simply
            // isn't quantified rather than a number being invented for it.
            parts.push(hit.stockQuantity != null ? `${hit.stockQuantity} in stock right now` : "in stock");
          } else if (hit.description) parts.push(hit.description);
          if (isAvailable(hit) && hit.options) parts.push(`Choices: ${hit.options}`);
          return emit([{ body: parts.join(". ") }], "open", ctx);
        }
        return emit([{ body: `Which product did you mean? ${formatCatalog(assistant, catalogProducts)}` }], "open", ctx);
      }
      if (intent.kind === "order") {
        const hit = catalogProducts.find((p) => p.id === intent.productId);
        if (hit && !isAvailable(hit)) {
          return emit([{ body: `Sorry, ${hit.name} is out of stock right now — I can let you know when it's back, or show you what else we have.` }], "open", ctx);
        }
        if (hit) {
          // Acknowledge a discount/negotiation request honestly instead of
          // silently proceeding at full price as if they never asked.
          const askedDiscount = /\b(discount|cheaper|lower price|reduce|bargain|deal|offer)\b/i.test(lower);
          if (askedDiscount) await announceNow("We don't have discounts set up for this right now.");
          // The AI may have already extracted a quantity AND an option answer
          // from ONE message ("rangi ya blue, size yoyote na nataka tano") —
          // use them directly instead of re-asking for something already given.
          if (intent.quantity == null) {
            return emit(
              [{ body: `How many ${hit.name} would you like?` }],
              "awaiting_order_quantity",
              { pendingOrder: { productId: hit.id, productName: hit.name, quantity: 0, unitPrice: hit.price, currency: hit.currency, options: hit.options, optionChosen: intent.optionAnswer, questionsAsked: 1 } },
            );
          }
          return advanceOrder({ productId: hit.id, productName: hit.name, quantity: intent.quantity, unitPrice: hit.price, currency: hit.currency, options: hit.options, optionChosen: intent.optionAnswer });
        }
      }
      // intent.kind === "none" (or an order with no valid product resolved) →
      // fall through to normal handling below (FAQs, general questions, etc.).
    }
  }

  // Factored out, 2026-08-23 — real bug found live-testing the pilot
  // recruiting flow on the widget: an unrecognized contact's very FIRST
  // message ("I want to talk to a human") was being swallowed whole by the
  // "unknown contact → warm welcome" block right below (it used to return
  // before ever reaching the escalation check that originally lived much
  // further down), so the AI answered it as small talk instead — and
  // fabricated "You're chatting with a real person right now!", a real
  // invented-claim violation of the exact "never invent whether something
  // happened" rule this whole Evidence & Assurance effort is about.
  // Escalation is now checked (via this same helper) from BOTH the
  // unrecognized-first-message branch below and the original later check,
  // so it fires regardless of whether this is someone's first message or
  // their fifth.
  // contact/conversation passed explicitly rather than closed over — TS
  // narrows them to non-null at each call site (both plain, synchronous
  // spots in the main function body) but can't carry that narrowing through
  // a nested function's closure over the mutable `let` bindings.
  async function escalateToHuman(escalatingContact: NonNullable<typeof contact>, escalatingConversation: NonNullable<typeof conversation>, opts?: { distress?: boolean }) {
    // Duplicate-escalation detection (docs/OPERATIONS-GUIDE-2026-08-23.md
    // §47) — captured once here, at the moment of escalation, since this is
    // the one place we reliably know "something went wrong enough that a
    // human asked for help".
    //
    // REAL correction made live 2026-08-23, not a hypothetical: the first
    // version compared the AI's own last reply, on the theory that it's
    // "what allegedly went wrong". Tested live with two contacts asking the
    // literal same question ("do you offer free shipping to Antarctica") —
    // the AI phrased its decline completely differently each time (a
    // different penguin joke), so word-overlap similarity between the two
    // replies came out under the match threshold despite being genuinely
    // the same issue. Switched to comparing the CUSTOMER's own prior
    // message instead — directly matches the actual scenario duplicate
    // detection exists for (the same broadcast/status reaching many people,
    // who then type the same or a very similar question), is far more
    // literal/robust than comparing free-form AI phrasing, and re-verified
    // live: the same two-contact test now correctly linked as duplicates.
    // `skip`'s target is the message BEFORE the current escalation request
    // — the just-recorded current message (line ~326, earlier in
    // handleInbound) is always priorMessages[0] at this point, so [1] is
    // what they were actually asking about. Falls back to null (skips
    // dedup entirely, not a false match) if this is genuinely their first
    // message ever — no prior content exists to compare.
    const priorMessages = await db.message.findMany({ where: { conversationId: escalatingConversation.id, direction: "in" }, orderBy: { createdAt: "desc" }, take: 2, select: { body: true } });
    const triggerText = priorMessages[1]?.body ?? null;
    // A distress ticket is never merged/deprioritized as a "duplicate" of
    // someone else's crisis — every one gets its own full-priority ticket.
    const duplicate = !opts?.distress && triggerText ? await findLikelyDuplicate(tenant.id, triggerText) : null;

    const ticket = await db.supportTicket.create({
      data: {
        number: await nextTicketNumber(),
        tenantId: tenant.id, conversationId: escalatingConversation.id, contactId: escalatingContact.id,
        subject: opts?.distress ? `SAFEGUARDING — possible distress from ${escalatingContact.displayName ?? input.fromNumber}` : `Escalation from ${escalatingContact.displayName ?? input.fromNumber}`,
        // "tenant" per the 3-way source split (docs/PUBLIC-FEEDBACK-QUALITY-
        // CENTRE-2026-08-23.md) — this is the exact "already happens
        // informally today" precedent that split was written around.
        source: "tenant",
        category: opts?.distress ? "safeguarding" : undefined,
        priority: opts?.distress ? "urgent" : "normal",
        slaDeadlineAt: await computeSlaDeadline(opts?.distress ? "urgent" : "normal"),
        triggerText,
        duplicateOfId: duplicate?.ticketId,
      },
    });
    await db.ticketEvent.create({ data: { ticketId: ticket.id, type: "created", visibility: "internal", detail: { source: opts?.distress ? "distress_detection" : "conversation_escalation", ...(duplicate ? { possibleDuplicateOf: duplicate.ticketId, similarity: duplicate.similarity } : {}) } } });
    await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: escalatingContact.id, action: "escalate", success: true, detail: { ticketNumber: ticket.number } });
    // The reply below promises "notified the team" — this is what actually
    // makes that true, instead of the promise being backed by nothing.
    // Real bug found in a code-review pass, 2026-08-22: this hardcoded
    // "WhatsApp" regardless of the actual channel — staff reading this
    // notification could be misdirected to reply on the wrong channel for a
    // Telegram/Messenger/email escalation.
    await queueNotification("ticket_created", `${opts?.distress ? "🚨 URGENT — SAFEGUARDING: " : "New "}${getCurrentChannelLabel()} escalation ${ticket.number ?? ticket.id} from ${tenant.name}: ${ticket.subject}`).catch(() => {});
    // Real gap found writing docs/OPERATIONS-GUIDE-2026-08-23.md: the user
    // was never told their own ticket number, even though it's generated
    // right here — nothing to reference if they follow up later.
    const ref = ticket.number ? ` Your reference is ${ticket.number}.` : "";
    // Distress reply deliberately does NOT attempt to counsel, does NOT
    // recite a specific crisis-helpline number (an unverified or
    // out-of-date number stated as fact could cause real harm — this is a
    // first-pass CAN-tier mitigation, not the SHOULD-tier fix, which
    // requires each tenant to nominate a real, confirmed contact and
    // helpline at onboarding), and does NOT continue toward the original
    // question — only a warm, honest handoff.
    const body = opts?.distress
      ? `I can hear that things feel really heavy right now, and I want a real person from ${tenant.name} to reach out to you as soon as possible — I've flagged this urgently.${ref} If you or someone else is in immediate danger, please reach out to someone you trust or your local emergency services right away.`
      : `I've created a support request and notified the team.${ref} Someone will get back to you shortly.`;
    return emit([{ body }], "escalated", { lastResource: ctx.lastResource });
  }

  // ── Unknown contact → warm welcome + self-service linking, never a cold "no" ─
  // Gated on history.length === 0 (genuinely the FIRST message ever in this
  // conversation — `history` already excludes the current inbound message),
  // not just "still unlinked" — an unlinked contact stays unlinked forever,
  // so without this gate this block would fire on EVERY message from them,
  // repeating the full welcome+decline boilerplate instead of ever reaching
  // real answer-handling below. Real bug found live-testing the widget
  // (2026-08-21): the widget deliberately sets status "open" here (not
  // "awaiting_identify", since that flow can never succeed on this channel —
  // see below), so nothing else was catching turn 2+ before this fix. Also
  // improves a related pre-existing WhatsApp edge case: someone who CANCELs
  // out of the identify flow and then asks something else previously hit
  // this same block again instead of just being answered.
  if (contact.contactRoles.length === 0 && history.length === 0) {
    if (isEscalationRequest) return escalateToHuman(contact, conversation);
    const ob = onboardingFor(tenant.industry);
    const identify = await db.connectorAction.findFirst({ where: { key: "IDENTIFY", connector: { tenantId: tenant.id, status: "active" } } });
    const actionsNow0 = await loadActions(tenant.id);
    const caps = numberedMenu(actionsNow0).text;
    const hello = branding.welcome ?? `👋 Hello! You've reached ${assistant}.`;
    // "Never recognize you" must never be the WHOLE reply to someone's actual
    // first question — a prospective parent/visitor's very first message is
    // often already a real question ("what are your fees"), not a greeting.
    // Answer it for real (grounded in the org's FAQs, same as everyone else
    // gets) before/alongside the welcome, instead of only ever showing the
    // generic intro. Skipped for a pure greeting — no point calling the AI to
    // "answer" a plain "hi".
    const st0 = (!isGreeting(text) && aiEnabled())
      ? await smallTalk(assistant, text, [...actionsNow0.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs)
      : null;
    const intro = st0 ? `${st0}\n\n${hello}` : hello;
    // A tenant with ZERO configured capabilities (e.g. a pure-FAQ/marketing
    // tenant with no connectors at all — found live-testing the landing
    // page's own self-referential widget, 2026-08-22) has no "account" to
    // connect and nothing to list — the "I can help X with things like:
    // [blank]" + identify/connect-your-account language below is written for
    // tenants with real per-user records, and reads broken with an empty
    // capability list. The grounded answer (or a plain welcome) is the
    // honest, complete reply when there's genuinely nothing else to offer.
    if (actionsNow0.length === 0) {
      return emit([{ body: intro }], "open", {});
    }
    // Website widget (Phase 8e, 2026-08-21 — real bug, not just copy): the
    // "reply with your admission number" invitation is a dead end on this
    // channel, not just currently blocked. The identify check requires the
    // caller's identity to be a REAL registered phone number (verified
    // against the org's own backend, e.g. demo-school/identify's
    // parentPhones match) — a widget session id never is one, so self-
    // service linking cannot succeed here no matter what's typed. Also,
    // "this number" is a confusing phrase on a channel with no visible
    // number at all. Never invite it, never set awaiting_identify — point to
    // WhatsApp honestly instead, same pattern as the OTP block one step
    // later in this same flow.
    if (input.channelType === "widget") {
      const note = await widgetOtpBlockedMessage(tenant.id, "connect your account for personalized help");
      return emit([{ body: `${intro}\n\nI can help ${ob?.audience ?? "you"} with things like:\n${caps}\n\n${note}` }], "open", {});
    }
    if (ob && identify) {
      return emit([{ body: `${intro}\n\nI can help ${ob.audience} with things like:\n${caps}\n\nI don't recognize this number yet. To connect you securely, reply with your ${ob.idLabel} — the one ${ob.office} has on file for you.` }], "awaiting_identify", {});
    }
    return emit([{ body: `${intro}\n\nI can help ${ob?.audience ?? "registered users"} with things like:\n${caps}\n\nI don't recognize this number yet — please contact ${ob?.office ?? "the organization"} to get set up.` }], "open", {});
  }

  // ── Greetings / help / escalation ───────────────────────────────────────
  // Only treat it as a greeting if that's ALL it is (computed above). "hey, how
  // much do I owe?" opens with a greeting but carries a real request, so it falls
  // through to intent detection instead of bouncing back the menu.
  if (pureGreeting) {
    const menu = numberedMenu(await loadActions(tenant.id));
    const first = (contact.displayName ?? "").split(" ")[0];
    // A real greeting varies every time — a real person doesn't say the exact
    // same words back no matter how you greeted them. Only the menu below (the
    // actual factual capability list) stays fixed; the opening line doesn't.
    const aiHi = aiEnabled()
      ? await complete(
          `You're a warm, genuinely friendly human staff member on ${assistant}'s ${getCurrentChannelLabel()}, greeting someone RIGHT NOW (${nowStr()}). ${first ? `Their name is ${first} — greet them by name.` : `You don't know their name — don't invent one.`} Match their energy/language from what they just said (casual, formal, Swahili, Sheng, etc.). Vary your wording every single time — never a template, never robotic, sound like a real person who's glad to hear from them. ONE short sentence only, no menu or list (that's added separately). Reply with ONLY that sentence.`,
          text,
          60,
          0.9,
        )
      : null;
    const hi = aiHi?.trim() || (first ? `Good ${partOfDay()}, ${first}! 👋 Welcome back to ${assistant}.` : `Good ${partOfDay()}! 👋 ${branding.welcome ?? `Welcome to ${assistant}.`}`);
    return emit([{ body: `${hi}${menuPrompt(menu)}` }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
  }
  if (isEscalationRequest) return escalateToHuman(contact, conversation);

  const dispatchBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };

  // ── Numbered-menu selection: a bare "1" / "2" picks a listed capability ──
  if (/^\s*\d{1,2}\s*$/.test(text) && ctx.menu && ctx.menu.length) {
    const pick = ctx.menu[parseInt(text, 10) - 1];
    if (pick) {
      const run = await dispatchAction(dispatchBase, pick, {}, ctx);
      return emit(run.replies, run.status, run.ctx);
    }
  }

  // ── Broad "tell me about <person>" → ONE real overview ───────────────────
  // A summary request pulls the non-sensitive reads (attendance, fee balance,
  // arrival, next appointment) for the resolved resource into a single grounded
  // reply. Handled here, BEFORE the router, so an open-ended ask can never be
  // force-fit into a single action (that's what made "tell me more about her"
  // ask for a booking date).
  if (isOverviewRequest(lower)) {
    const target = await resolveOverviewTarget(text, grants, tenant.id, ctx.lastResource);
    if (target && "ask" in target) return emit([{ body: target.ask }], "open", { lastResource: ctx.lastResource });
    if (target) {
      const ov = await runOverview(dispatchBase, target.grantKey, target.student);
      return emit(ov.replies, ov.status, ov.ctx);
    }
    // No resolvable resource → fall through to normal handling.
  }

  // ── Detect intent ───────────────────────────────────────────────────────
  const actions = await loadActions(tenant.id);
  // Deliberately NOT an early bail-out when actions.length === 0 (real bug,
  // found live-testing the landing page's own self-tenant, 2026-08-22): a
  // tenant with zero connectors but real approved FAQs — e.g. a pure-FAQ/
  // marketing tenant, or any org early in onboarding before connecting a
  // system — was getting a hardcoded "hasn't connected any systems yet." for
  // EVERY message, even ones its FAQs could answer. `understand()`/
  // `matchIntent()`/`numberedMenu()` all handle an empty `actions` array
  // safely (map/slice over nothing), so this now falls through to the same
  // FAQ-grounded `smallTalk()` path every other tenant already gets below.
  // AI-request quota — only actually blocks anything when AI would be used at
  // all (aiEnabled()); the deterministic fallback path records "api_call",
  // never limited by this. Declared in Plan.limits and metered for a long
  // time, but never enforced anywhere until this — a tenant could exceed it
  // indefinitely with no block, matching the message_in pattern for real now.
  if (aiEnabled()) {
    const aiLimit = await checkLimit(tenant.id, "ai_request");
    if (!aiLimit.ok) {
      return emit([{ body: "This service has reached its monthly AI request limit. Please contact the organization." }], "open", ctx);
    }
  }
  const match = await understand(text, actions, history);
  await meter(tenant.id, match.via === "ai" ? "ai_request" : "api_call", match.via === "ai" ? 1 : 0);

  if (!match.actionId || match.score < 0.15) {
    // A text-only follow-up about a document read earlier in THIS conversation
    // ("what does it say about X?") — answer from what we remembered instead of
    // making them resend the file, as long as they have credit for a quick query.
    if (ctx.lastDocument && aiEnabled()) {
      const canAfford = recognizedFree || contact.credits >= 1;
      if (canAfford) {
        const system = `You are a helpful assistant on ${assistant}'s WhatsApp. The user is asking a follow-up question about a document titled "${ctx.lastDocument.label}" that they sent earlier in this chat. Answer ONLY from the document text below — never invent details. If the question isn't actually about the document, or the answer isn't in it, say so honestly rather than guessing. Reply in the user's language, concisely, WhatsApp-style. Do not say you are an AI.`;
        const user = `DOCUMENT TEXT ("${ctx.lastDocument.label}"):\n${ctx.lastDocument.text}\n\nThe user asked: ${JSON.stringify(text)}`;
        const out = await complete(system, user, 500, 0.3);
        if (out) {
          const replies: Reply[] = [{ body: out }];
          if (!recognizedFree) {
            const remaining = contact.credits - 1;
            await db.contact.update({ where: { id: contact.id }, data: { credits: remaining } });
            replies.push({ kind: "system", body: `— 1 credit used · ${remaining} left`, meta: { credits: remaining } });
          }
          await meter(tenant.id, "tool_run");
          return emit(replies, "open", ctx);
        }
      }
    }
    const menu = numberedMenu(actions);
    // If AI is on, answer chit-chat naturally (still grounded to real capabilities).
    const st = await smallTalk(assistant, text, [...actions.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs);
    // Fallback ONLY if the AI is truly unavailable (after retries — e.g. every
    // configured provider is rate-limited/out of quota at once). Never leave a
    // bedrock identity question unanswered just because AI is briefly down —
    // check that FIRST, deterministically. Otherwise keep it warm and ask,
    // rather than cold-dumping the menu: a friendly remark gets a warm ack;
    // anything else gets a gentle "tell me more" with the menu as a backup.
    const first = (contact.displayName ?? "").split(" ")[0];
    const fallback = identityFallbackAnswer(lower, assistant)
      ?? (isSocialChit(lower)
        ? warmAck(text)
        : actions.length > 0
          ? `I want to make sure I get you the right thing${first ? `, ${first}` : ""} 😊 Could you tell me a little more about what you need? For example, checking attendance, exam results, a fee balance, booking an appointment, or sending me a spreadsheet to analyze — or reply with a number:\n${menu.text}`
          : `I want to make sure I get you the right thing${first ? `, ${first}` : ""} 😊 Could you tell me a little more about what you're looking for?`);
    return emit([{ body: st ?? fallback }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
  }

  // Guard against vague → WRITE misroutes: never START a booking/create/cancel
  // flow (which would ask for a date, etc.) unless the user actually expressed
  // intent to make or change something. "help me with my son's information" is a
  // request for INFO, not a booking — so we clarify instead of asking for a date.
  const matchedAction = await db.connectorAction.findUnique({ where: { id: match.actionId } });
  const isWrite = !!matchedAction && (matchedAction.requiresConfirm || /^(BOOK|CANCEL|SUBMIT|RESCHEDULE|CREATE|UPDATE|REQUEST)/i.test(matchedAction.key));
  const hasWriteVerb =
    /\b(book|booking|schedule|reschedule|re-?book|cancel|arrange|reserve|set ?up|create|request|submit|apply|register|sign ?up)\b/i.test(lower) ||
    /\b(make|set up|need|want|get|have)\b.{0,15}\b(appointment|meeting|booking)\b/i.test(lower);
  if (isWrite && !hasWriteVerb) {
    const menu = numberedMenu(actions);
    const st = await smallTalk(assistant, text, [...actions.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs);
    const first = (contact.displayName ?? "").split(" ")[0];
    const ask = `Happy to help${first ? `, ${first}` : ""}! What would you like to do exactly — for example check attendance, exam results, a fee balance, or book an appointment?`;
    return emit([{ body: st ?? ask }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
  }

  const run = await dispatchAction(dispatchBase, match.actionId, match.entities, ctx);
  return emit(run.replies, run.status, run.ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchAction: resolve the target resource from grants → collect params →
// authorize/confirm/execute. Shared by typed intents AND numbered-menu picks.
// Returns replies + next status/context (the caller emits).
// ─────────────────────────────────────────────────────────────────────────────

async function dispatchAction(
  base: CollectBase,
  actionId: string,
  entities: Record<string, string>,
  prevCtx: ConvContext,
): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> {
  const resolved: Record<string, unknown> = {};
  const action = await db.connectorAction.findUnique({ where: { id: actionId } });
  if (!action) return { replies: [{ body: "That capability is not available right now." }], status: "open", ctx: prevCtx };

  const specs = (action.paramSchema as unknown as ParamSpec[]) ?? [];
  const resourceParam = action.resourceParam ?? undefined;
  const grantKey = action.resourceGrantKey ?? undefined;
  let lastResource = prevCtx.lastResource;
  if (resourceParam && grantKey) {
    const noun = resourceNoun(grantKey);
    const options = base.grants[grantKey] ?? [];
    const name = entities.name;
    let chosen: ResourceGrant | undefined;
    // The user is explicitly asking about SOMEONE ELSE (not a record linked to
    // them). Don't silently default to their own record — say plainly what they
    // can access. (Prevents "results of another student" quietly returning theirs.)
    const ut = (base.userText ?? "").toLowerCase();
    if (!name && /\b(another|different|other|someone ?else'?s|a new)\s+(student|child|kid|pupil|learner|patient|employee|member|person)\b/.test(ut)) {
      const yours = options.map((o) => o.name).join(", ");
      return {
        replies: [{ body: options.length
          ? `I can only access records for the ${noun}${options.length > 1 ? "s" : ""} linked to your account${yours ? ` (${yours})` : ""}. I'm not able to look up anyone else's records.`
          : `You don't have any ${noun} records linked to your account yet.` }],
        status: "open",
        ctx: { lastResource },
      };
    }
    if (name) {
      const q = name.toLowerCase();
      const hits = options.filter((o) => o.name.toLowerCase().includes(q) || String(o.id).toLowerCase().includes(q));
      if (hits.length === 1) chosen = hits[0];
      else if (hits.length > 1) {
        const list = hits.map((h, i) => `${i + 1}. ${resourceLabel(h)}`).join("\n");
        return {
          replies: [{ body: `I found more than one match. Please tell me which one:\n${list}` }],
          status: "awaiting_resource_pick",
          ctx: { ...prevCtx, pendingDisambiguation: { actionId, entities, candidates: hits.map((h) => ({ id: h.id, name: h.name })) } },
        };
      } else {
        return { replies: [{ body: `I couldn't find a ${noun} matching "${name}" linked to your account.` }], status: "open", ctx: { lastResource } };
      }
    } else if (prevCtx.lastResource && prevCtx.lastResource.grantKey === grantKey) {
      chosen = prevCtx.lastResource;
    } else if (options.length === 1) {
      chosen = options[0];
    } else if (options.length === 0) {
      return { replies: [{ body: `There are no ${noun} records linked to your account. Please contact the organization.` }], status: "open", ctx: prevCtx };
    } else {
      const list = options.map((h, i) => `${i + 1}. ${resourceLabel(h)}`).join("\n");
      return {
        replies: [{ body: `Which ${noun} do you mean?\n${list}` }],
        status: "awaiting_resource_pick",
        ctx: { ...prevCtx, pendingDisambiguation: { actionId, entities, candidates: options.map((h) => ({ id: h.id, name: h.name })) } },
      };
    }
    resolved[resourceParam] = chosen.id;
    lastResource = { id: chosen.id, name: chosen.name, grade: chosen.grade, grantKey };
  }

  for (const spec of specs) {
    if (spec.from !== "entity") continue;
    const entity = spec.entity ?? spec.name;
    if (resourceParam && entity === resourceParam) continue;
    const val = entities[entity];
    if (val) resolved[spec.name] = val;
  }

  return continueCollection(base, action.id, resolved, lastResource);
}

/** Identity-level facts the AI may share in casual chat — the person's own name
 *  and the names of records linked to them (student/employee/patient). NOT the
 *  sensitive data behind those records (fees, grades, etc.), which still require
 *  an authorized lookup. Keeps small talk helpful without inventing anything. */
/** Super-app tool capabilities (data analysis, etc.), described for the AI's
 *  small-talk prompt so it never denies a capability that actually exists —
 *  these work for ANY sender, independent of the org's connector actions. */
function toolCapabilityLines(): string[] {
  // Real bug found live 2026-08-22: this always listed file-based tools
  // (document/spreadsheet analysis), so the AI confidently invited a
  // website-widget visitor to "drop a file right here" — a real P2Less
  // capability, but not one this channel can actually receive (the widget,
  // like Messenger/Telegram/Email, is text-only today; only WhatsApp
  // supports attachments). Never advertise a capability the current channel
  // can't deliver on.
  if (!currentChannelSupportsFiles()) return [];
  return allTools().map((t) => `${t.name} — ${t.description} (the user just needs to SEND the file, no need to ask first)`);
}

/** AI-unavailable-only fallback for commerce intent — the old keyword-regex
 *  approach, kept solely so the platform still works with zero API key
 *  configured. When AI is enabled (the normal case), classifyCommerceMessage()
 *  in ai.ts is used instead — it understands meaning, typos, and any language,
 *  which this cannot. */
function localCommerceIntent(lower: string, text: string, products: Parameters<typeof matchProduct>[1]): CommerceIntent {
  if (isProductImageRequest(lower)) {
    const { hit } = matchProduct(text, products);
    return { kind: "image_question", productId: hit?.id };
  }
  if (isCatalogBrowseRequest(lower)) return { kind: "browse" };
  if (isOrderRequest(lower)) {
    const { hit } = matchProduct(text, products);
    if (hit) return { kind: "order", productId: hit.id, quantity: hasExplicitQuantity(text) ? extractQuantity(text) : undefined };
    return { kind: "none" };
  }
  if (!/\?/.test(lower) && text.trim().split(/\s+/).length <= 4) {
    const hit = findExactProductMention(text, products);
    if (hit) return { kind: "order", productId: hit.id, quantity: hasExplicitQuantity(text) ? extractQuantity(text) : undefined };
  }
  if (isProductAttributeQuestion(lower)) {
    const { hit } = matchProduct(text, products);
    return { kind: "price_question", productId: hit?.id };
  }
  return { kind: "none" };
}

/** Universal Platform roadmap Phase 4 (2026-08-19) — the structured, provenance-
 *  tagged form of buildKnownFacts(). Each entry carries a real FactSource
 *  (see provenance.ts) so a future consumer (an admin "why did the bot say
 *  this" view, an audit log) can distinguish what's genuinely retrieved vs.
 *  computed vs. org-configured. buildKnownFacts() below wraps this and joins
 *  ONLY the `text` fields — guaranteed byte-identical to the prompt text this
 *  function produced before Phase 4, so the AI's actual behavior (proven
 *  correct across many prior fixes this project) is completely unchanged;
 *  Phase 4 makes the provenance real without touching the tuned prompt. */
function buildKnownFactEntries(displayName: string | null | undefined, grants: Record<string, ResourceGrant[]>, lastOrder?: ConvContext["lastOrder"], lastAction?: ConvContext["lastAction"]): { text: string; source: FactSource }[] {
  const entries: { text: string; source: FactSource }[] = [];
  if (displayName) entries.push({ text: `- The CONTACT you're chatting with (their own name) is ${displayName}.`, source: { kind: "known", system: "contact_record" } });
  else entries.push({ text: `- We do not have the CONTACT's own name on file — do not guess or assign them one.`, source: { kind: "unknown" } });
  for (const [key, items] of Object.entries(grants)) {
    const names = (items ?? []).map((g) => resourceLabel(g)).filter(Boolean);
    // Explicit so the model never conflates the contact with their dependent —
    // a parent is NOT their child, an HR contact is NOT the employee, etc.
    if (names.length) entries.push({ text: `- Linked ${key} (these are records the CONTACT looks after / is associated with — NOT the contact's own identity): ${names.join(", ")}.`, source: { kind: "known", system: "contact_record" } });
  }
  if (lastOrder) {
    const statusText = lastOrder.status === "paid" ? "paid" : "an M-Pesa payment prompt was sent to this number and we're waiting for them to enter their PIN";
    entries.push({ text: `- Their most recent order (this really happened, it is NOT a test or a mistake — state it as fact if asked): ${lastOrder.quantity} × ${lastOrder.productName} = ${lastOrder.currency} ${lastOrder.total.toLocaleString("en-US")}, reference ${lastOrder.reference}, STK push sent to ${lastOrder.phone}, status: ${statusText}.`, source: { kind: "known", system: "platform_order" } });
  }
  if (lastAction) {
    entries.push({ text: `- The most recent thing you actually did for them (this really happened — state it as fact, e.g. if asked "did you book it?"): ${lastAction.description}`, source: { kind: "known", system: "platform_action" } });
  }
  return entries;
}

function buildKnownFacts(displayName: string | null | undefined, grants: Record<string, ResourceGrant[]>, lastOrder?: ConvContext["lastOrder"], lastAction?: ConvContext["lastAction"]): string {
  return buildKnownFactEntries(displayName, grants, lastOrder, lastAction).map((e) => e.text).join("\n");
}

/** Does this message look like friendly social chit-chat / acknowledgement (as
 *  opposed to a real request)? Used only as a graceful fallback when the AI is
 *  momentarily unavailable, so we answer warmly instead of dumping the menu. */
function isSocialChit(lower: string): boolean {
  const t = lower.replace(/[^a-z\s']/g, " ").trim();
  if (!t) return true; // just an emoji / punctuation
  if (t.split(/\s+/).length > 8) return false; // long → probably a real request
  return /\b(thanks|thank you|thx|asante|happy|glad|great|good|nice|cool|awesome|amazing|wonderful|perfect|lovely|excellent|appreciate|appreciated|well done|bravo|wow+|woo+|yay+|haha+|lol|ok|okay|okey|alright|sure|fine|nice one|much appreciated|god bless|blessed|cheers|good to hear|happy to hear|that'?s (great|good|nice|wonderful|lovely))\b/.test(t);
}

/** A warm, human acknowledgement for social chit-chat (deterministic fallback). */
function warmAck(text: string): string {
  const l = text.toLowerCase();
  if (/(thank|thx|asante|appreciate|cheers)/.test(l)) return "You're very welcome! 😊 I'm here whenever you need anything.";
  if (/(happy|glad|great|good to hear|wonderful|lovely|nice|perfect|awesome|amazing)/.test(l)) return "So glad to hear that! 😊 Let me know if there's anything else I can help you with.";
  return "😊 Anytime! Just let me know if there's anything you need.";
}

/** Basic identity/platform questions ("what's your name", "who owns you",
 *  "what is p2less") answered directly WITHOUT needing an AI call — these are
 *  fixed, always-true platform facts, not something worth risking on AI being
 *  reachable. Used as a deterministic fallback when smallTalk() returns null
 *  (AI down/unavailable) so at least these bedrock questions never go
 *  unanswered or get a generic "tell me more" non-reply. */
function identityFallbackAnswer(lower: string, assistant: string): string | null {
  // Real bug found in a Telegram/email code-review pass, 2026-08-22: both
  // messages below hardcoded "WhatsApp" regardless of the real channel — this
  // fallback fires on EVERY channel (no channelType gate above it), and
  // specifically whenever the AI is unavailable, so a Telegram/Messenger/
  // email user hitting an AI outage got a confidently wrong "I'm the
  // WhatsApp assistant" / "it's the WhatsApp technology... on WhatsApp".
  // Same bug class already fixed once in smallTalk()'s own prompt (see
  // tenant-context.ts) — this deterministic fallback was a separate,
  // missed call site. getCurrentChannelLabel() is safe to call directly
  // here: handleInbound() already set the channel context before this runs.
  const channel = getCurrentChannelLabel();
  if (/\b(your name|who are you|what('?s| is) your name)\b/.test(lower)) {
    return `I'm ${assistant}'s assistant, running on P2Less. Happy to help — what do you need?`;
  }
  if (/\b(who (made|built|owns|runs) you|whose are you|to whom do you belong|who do you belong to|who is hamisi|who is onesmus|who is kilumo)\b/.test(lower)) {
    return `I run on P2Less, built by Hamisi Onesmus Kilumo — a software engineer and founder/CEO of Hamzone Technologies. What can I help you with?`;
  }
  if (/\bwhat (is|does) p2less( mean| stand for)?\b|\bp2less inamaana gani\b/.test(lower)) {
    return `P2Less means "paperless" — it's the technology (built by Hamisi Onesmus Kilumo of Hamzone Technologies) that lets you handle things like this right here on ${channel}, no separate app or login needed. What can I help you with?`;
  }
  return null;
}

/** Is this a broad "tell me about / overview / how is X doing" style request? */
function isOverviewRequest(lower: string): boolean {
  return /(tell me (more )?about|more about (him|her|them|my|the)|an? (overview|summary|rundown|recap)|overview of|everything about|full (picture|details|update|report)|general (info|overview|update|picture)|catch me up|fill me in|status (update|report)|how (is|are|'?s) [\w']+ doing|how (is|are) (he|she|they|my))/i.test(lower);
}

type OverviewTarget = { grantKey: string; student: LastResource };

/** Resolve WHO an overview is about: a name in the text, the last resource, or a
 *  sole linked record. Returns {ask} to disambiguate, or null if none apply. */
async function resolveOverviewTarget(
  text: string,
  grants: Record<string, ResourceGrant[]>,
  tenantId: string,
  lastResource?: LastResource,
): Promise<OverviewTarget | { ask: string } | null> {
  // Grant types that actually have overview-able (non-sensitive) read actions.
  const reads = await db.connectorAction.findMany({
    where: { enabled: true, key: { not: "IDENTIFY" }, requiresConfirm: false, requiresStepUp: false, resourceGrantKey: { not: null }, connector: { tenantId, status: "active" } },
    select: { resourceGrantKey: true },
  });
  const overviewKeys = new Set(reads.map((r) => r.resourceGrantKey!).filter(Boolean));
  const keys = Object.keys(grants).filter((k) => overviewKeys.has(k) && (grants[k]?.length ?? 0) > 0);
  if (keys.length === 0) return null;

  const q = text.toLowerCase();
  // 1) A first name mentioned in the message.
  for (const k of keys) {
    const hit = (grants[k] ?? []).find((r) => r.name && q.includes(r.name.split(" ")[0].toLowerCase()));
    if (hit) return { grantKey: k, student: { id: hit.id, name: hit.name, grade: hit.grade, grantKey: k } };
  }
  // 2) The resource we were just talking about (resolves "her"/"him"/"them").
  if (lastResource?.grantKey && keys.includes(lastResource.grantKey)) return { grantKey: lastResource.grantKey, student: lastResource };
  // 3) A single linked record → unambiguous.
  if (keys.length === 1 && (grants[keys[0]]?.length ?? 0) === 1) {
    const r = grants[keys[0]][0];
    return { grantKey: keys[0], student: { id: r.id, name: r.name, grade: r.grade, grantKey: keys[0] } };
  }
  // 4) Multiple → ask which.
  const names = keys.flatMap((k) => (grants[k] ?? []).map((r) => r.name));
  return { ask: `Sure — who would you like an overview of? ${names.join(", ")}` };
}

/** Build a single grounded overview by running the resource's non-sensitive read
 *  actions and combining them. Sensitive reads (results, behind step-up/OTP) are
 *  offered, not included. The AI humanizes the combined facts in the user's tongue. */
async function runOverview(base: CollectBase, grantKey: string, student: LastResource): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> {
  const actions = await db.connectorAction.findMany({
    where: { enabled: true, key: { not: "IDENTIFY" }, resourceGrantKey: grantKey, requiresConfirm: false, requiresStepUp: false, connector: { tenantId: base.tenantId, status: "active" } },
    orderBy: { name: "asc" },
  });
  const lines: string[] = [];
  for (const action of actions) {
    if (!action.resourceParam) continue;
    if (!hasPermission(base.permissions, action.requiredPermission)) continue;
    const result = await executeAction(action.id, { [action.resourceParam]: student.id });
    if (!result.ok || result.data.has === false) continue;
    const line = formatReply(action.replyTemplate, action.name, result.data);
    if (line && line.trim()) lines.push(line.trim());
  }
  const ctx: ConvContext = { lastResource: student };
  if (lines.length === 0) {
    return { replies: [{ body: `I don't have any details to show for ${student.name} at the moment. Please contact the office.` }], status: "open", ctx };
  }
  // Is there a sensitive (step-up) read we should OFFER but not include?
  const gated = await db.connectorAction.findFirst({ where: { enabled: true, requiresStepUp: true, resourceGrantKey: grantKey, connector: { tenantId: base.tenantId, status: "active" } } });
  const note = gated ? `\n(${gated.name} is available too — just ask and I'll quickly confirm it's you first.)` : "";
  const factText = `Here's an overview of ${student.name}${student.grade ? ` (${student.grade})` : ""}:\n- ${lines.join("\n- ")}${note}`;
  const body = aiEnabled() ? await humanizeReply(base.assistant, base.userText ?? "", factText, base.history ?? []) : factText;
  return { replies: [{ body }], status: "open", ctx };
}

function resourceNoun(grantKey: string): string {
  const map: Record<string, string> = { students: "student", employees: "employee", patients: "patient", orders: "order", members: "member" };
  return map[grantKey] ?? grantKey.replace(/s$/, "");
}
function resourceLabel(g: ResourceGrant): string {
  const detail = g.grade ?? (typeof g.detail === "string" ? g.detail : "");
  return detail ? `${g.name} — ${detail}` : g.name;
}

// ─────────────────────────────────────────────────────────────────────────────
// continueCollection: fill remaining required entity params one at a time
// (asking the user), then hand off to runAction (which does confirm/execute).
// Shared by the fresh-intent path and the awaiting_param resume.
// ─────────────────────────────────────────────────────────────────────────────

type CollectBase = {
  tenantId: string;
  reqId: string;
  contact: { id: string };
  permissions: string[];
  grants: Record<string, ResourceGrant[]>;
  assistant: string;
  channelType: string;
  contactName?: string;
  userText?: string;
  history?: ChatTurn[];
};

async function continueCollection(
  base: CollectBase,
  actionId: string,
  resolved: Record<string, unknown>,
  lastResource?: { id: string; name: string; grade?: string },
): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> {
  const action = await db.connectorAction.findUnique({ where: { id: actionId } });
  if (!action) return { replies: [{ body: "That capability is not available." }], status: "open", ctx: { lastResource } };
  const specs = (action.paramSchema as unknown as ParamSpec[]) ?? [];

  for (const spec of specs) {
    if (spec.from !== "entity") continue;
    const entity = spec.entity ?? spec.name;
    if (entity === "studentId") continue; // resolved earlier
    if (spec.required === false) continue; // optional — skip
    const have = resolved[spec.name];
    if (have !== undefined && have !== null && have !== "") continue;
    // First missing required parameter → ask for it.
    return {
      replies: [{ body: promptFor(entity) }],
      status: "awaiting_param",
      ctx: { lastResource, pendingActionId: actionId, pendingActionKey: action.key, pendingResolved: resolved, missingParam: spec.name, missingEntity: entity },
    };
  }

  // All required parameters present → proceed (authz → confirm → execute).
  return runAction({ ...base, actionId, resolved, alreadyConfirmed: false, lastResource });
}

function resolveEntityFromText(entity: string, text: string): string {
  const t = text.trim();
  if (entity === "date" || entity === "startDate" || entity === "endDate") return extractDate(t) ?? t;
  if (entity === "time") return extractTime(t) ?? t;
  return t;
}

function promptFor(entity: string): string {
  const prompts: Record<string, string> = {
    date: "What date would you prefer? (e.g. Tuesday, or 20 August)",
    startDate: "What date does your leave start? (e.g. 20 August)",
    endDate: "And what date does it end? (e.g. 23 August)",
    time: "What time works for you? (e.g. 10 AM)",
    reason: "What's the reason? (or reply 'skip')",
  };
  return prompts[entity] ?? `Please provide the ${entity}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// runAction: authorize → step-up → confirm → execute → format. Returns replies +
// the next conversation status/context. Shared by fresh intents and resumes.
// ─────────────────────────────────────────────────────────────────────────────

type RunArgs = {
  tenantId: string;
  reqId: string;
  contact: { id: string };
  permissions: string[];
  grants: Record<string, ResourceGrant[]>;
  assistant: string;
  channelType: string;
  contactName?: string;
  userText?: string;
  history?: ChatTurn[];
  actionId: string;
  resolved: Record<string, unknown>;
  alreadyConfirmed: boolean;
  lastResource?: { id: string; name: string; grade?: string };
  lastAction?: ConvContext["lastAction"];
};

async function runAction(args: RunArgs): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> {
  const { tenantId, reqId, contact, permissions, grants } = args;
  const action = await db.connectorAction.findUnique({ where: { id: args.actionId }, include: { connector: true } });
  if (!action) return { replies: [{ body: "That capability is not available." }], status: "open", ctx: { lastResource: args.lastResource } };

  const baseCtx: ConvContext = { lastResource: args.lastResource };

  // 1-4. Permission → resource (IDOR) → step-up → confirm — the single
  // source-of-truth gate (Universal Platform roadmap Phase 3), replacing
  // what used to be four separate inline checks here. See
  // evaluateCapabilityGate() in capability-gate.ts for why approvalRequired
  // is classified on the decision but not yet enforced.
  const resolvedResourceId = action.resourceParam ? (args.resolved[action.resourceParam] as string | undefined) : undefined;
  const grantedResourceIds = action.resourceGrantKey
    ? ((grants as Record<string, ResourceGrant[] | undefined>)[action.resourceGrantKey] ?? []).map((g) => g.id)
    : undefined;
  // Only pay for the session lookup when step-up is actually required —
  // same short-circuit the original inline check had.
  const verifiedSession = action.requiresStepUp ? await hasVerifiedSession(contact.id) : true;
  const decision = evaluateCapabilityGate({
    action: {
      requiredPermission: action.requiredPermission,
      resourceGrantKey: action.resourceGrantKey,
      resourceParam: action.resourceParam,
      requiresStepUp: action.requiresStepUp,
      requiresConfirm: action.requiresConfirm,
      approvalRequired: action.approvalRequired,
    },
    permissions,
    resolvedResourceId,
    grantedResourceIds,
    hasVerifiedSession: verifiedSession,
    alreadyConfirmed: args.alreadyConfirmed,
  });

  if (!decision.allowed) {
    await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "authz.deny", target: action.key, success: false, detail: { reason: decision.reason, targetId: decision.reason === "resource" ? resolvedResourceId : undefined } });
    return {
      replies: [{ body: decision.reason === "permission" ? "You don't have permission to access that." : "You're not authorized to view that record." }],
      status: "open",
      ctx: baseCtx,
    };
  }

  if (decision.step === "step_up") {
    // Website widget (Phase 8e, 2026-08-20): same block as self-service
    // linking above, same reason — no real second channel to verify a code
    // against, so decline honestly rather than pretend this is secure.
    if (args.channelType === "widget") {
      return { replies: [{ body: await widgetOtpBlockedMessage(tenantId, "view that") }], status: "open", ctx: baseCtx };
    }
    const issued = await issueOtp(tenantId, contact.id);
    if ("error" in issued) return { replies: [{ body: issued.error }], status: "open", ctx: baseCtx };
    await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "otp.issue", target: action.key, success: true });
    return {
      replies: buildOtpReplies(args.channelType, issued.code, args.contactName),
      status: "awaiting_otp",
      ctx: { ...baseCtx, pendingActionId: action.id, pendingActionKey: action.key, pendingResolved: args.resolved, otpChallengeId: issued.challengeId },
    };
  }

  if (decision.step === "confirm") {
    const values = { ...args.resolved, resourceName: args.lastResource?.name ?? "", studentName: args.lastResource?.name ?? "" };
    const summary = action.confirmTemplate ? fillTemplate(action.confirmTemplate, values) : (action.description ?? action.name);
    return {
      replies: [{ body: `${summary}\n\nReply CONFIRM to proceed, or CANCEL to stop.` }],
      status: "awaiting_confirm",
      ctx: { ...baseCtx, pendingActionId: action.id, pendingActionKey: action.key, pendingResolved: args.resolved },
    };
  }

  // decision.step === "execute" from here on.
  // 5. Execute the connector action (real HTTP to the external system)
  const result = await executeAction(action.id, args.resolved);
  if (!result.ok) {
    await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "connector.execute", target: action.key, success: false, detail: { code: result.code, error: result.error, latencyMs: result.latencyMs } });
    return {
      replies: [{ body: `I'm unable to retrieve that right now because the connected system is unavailable (${result.error}). Please try again later.` }],
      status: "open",
      ctx: baseCtx,
    };
  }
  await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "connector.execute", target: action.key, success: true, detail: { latencyMs: result.latencyMs, status: result.status } });

  // 6. Format the reply from the mapped data. If the action mapped a `has`
  //    boolean and it's false (e.g. no upcoming meeting), reply cleanly.
  if (result.data.has === false) {
    return { replies: [{ body: "You have nothing scheduled at the moment. 📭" }], status: "open", ctx: baseCtx };
  }
  // The template renders the exact, correct facts; the AI (if enabled) only
  // rephrases them into a warm, human reply — it can't change or invent any fact.
  const factText = formatReply(action.replyTemplate, action.name, result.data);
  const body = aiEnabled() ? await humanizeReply(args.assistant, args.userText ?? "", factText, args.history ?? []) : factText;
  const replies: Reply[] = [{ body }];

  // 7. Optional document generation + secure delivery (as a real PDF/file) —
  // gated by the plan's documentsPerMonth limit (checkLimit already supports
  // it; this was the one place it was declared but never actually enforced).
  // The factual reply above still sends either way — only the extra
  // generated file is held back once the limit is hit.
  const documentLimit = action.documentKind ? await checkLimit(tenantId, "document") : { ok: true };
  if (action.documentKind && !documentLimit.ok) {
    replies.push({ body: "This service has reached its monthly document limit — the information above is current, but a downloadable file isn't available until next month. Please contact the organization." });
  } else if (action.documentKind) {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    const b = (tenant?.branding as Record<string, string> | null) ?? {};
    const d = result.data;
    const num = (v: unknown) => Number(v ?? 0);
    let doc: GeneratedDoc | null = null;
    let label = "your document";
    try {
      if (action.documentKind === "report_card") {
        const student = args.lastResource;
        const rawResults = (d.results ?? (result.raw as { results?: unknown[] })?.results ?? []) as { subject: string; score: number; grade: string }[];
        if (student && Array.isArray(rawResults) && rawResults.length) {
          doc = await generateReportCard({ tenantId, contactId: contact.id, studentName: student.name, grade: student.grade ?? "", results: rawResults, branding: b });
          label = "report card";
        }
      } else if (action.documentKind === "payslip") {
        doc = await generatePayslipPdf({ tenantId, contactId: contact.id, org: args.assistant, color: b.primaryColor, footer: b.pdfFooter, name: String(d.name ?? args.contactName ?? ""), period: String(d.period ?? ""), currency: String(d.currency ?? "KES"), gross: num(d.gross), deductions: num(d.deductions), net: num(d.net) });
        label = "payslip";
      } else if (action.documentKind === "leave") {
        doc = await generateLeavePdf({ tenantId, contactId: contact.id, org: args.assistant, color: b.primaryColor, footer: b.pdfFooter, name: String(d.name ?? args.contactName ?? ""), reference: String(d.reference ?? ""), startDate: String(d.startDate ?? ""), endDate: String(d.endDate ?? ""), reason: d.reason ? String(d.reason) : undefined, status: String(d.status ?? "pending") });
        label = "leave request";
      } else if (action.documentKind === "fee_statement") {
        doc = await generateFeeStatementPdf({ tenantId, contactId: contact.id, org: args.assistant, color: b.primaryColor, footer: b.pdfFooter, studentName: String(d.name ?? args.lastResource?.name ?? ""), grade: args.lastResource?.grade, currency: String(d.currency ?? "KES"), billed: num(d.billed), paid: num(d.paid), balance: num(d.balance), dueDate: String(d.dueDate ?? "") });
        label = "fee statement";
      }
    } catch {
      doc = null; // document generation must never break the reply
    }
    if (doc) {
      replies.push({ kind: "document", body: `📄 Here's your ${label} (PDF).`, document: { url: doc.url, filename: doc.filename }, meta: { url: doc.url } });
    }
  }

  // Real WRITE actions (booking, cancelling, submitting, etc.) get remembered
  // the same way a paid order does — so a follow-up like "did you actually
  // book it?" is answered from what genuinely happened, never a generic "I
  // can't do that" (this DID happen) or an invented confirmation (be precise
  // about what, when, for whom).
  const wasWrite = action.requiresConfirm || /^(BOOK|CANCEL|SUBMIT|RESCHEDULE|CREATE|UPDATE|REQUEST)/i.test(action.key);
  let lastAction: ConvContext["lastAction"] | undefined;
  if (wasWrite) {
    const values = { ...args.resolved, resourceName: args.lastResource?.name ?? "", studentName: args.lastResource?.name ?? "" };
    const description = action.confirmTemplate ? fillTemplate(action.confirmTemplate, values) : (action.description ?? action.name);
    lastAction = { description, key: action.key };
  }
  return { replies, status: "open", ctx: { ...baseCtx, lastAction: lastAction ?? args.lastAction } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadActions(tenantId: string): Promise<IntentAction[]> {
  const actions = await db.connectorAction.findMany({
    // IDENTIFY is an internal onboarding capability, not a user-facing one.
    where: { enabled: true, key: { not: "IDENTIFY" }, connector: { tenantId, status: "active" } },
    orderBy: { name: "asc" },
  });
  return actions.map((a) => ({
    id: a.id,
    key: a.key,
    name: a.name,
    description: a.description,
    samplePhrases: (a.samplePhrases as string[] | null) ?? [],
  }));
}

function formatReply(template: string | null, fallbackName: string, data: Record<string, unknown>): string {
  if (!template) {
    // Generic rendering of mapped fields.
    const parts = Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && typeof v !== "object")
      .map(([k, v]) => `${humanize(k)}: ${v}`);
    return parts.length ? `${fallbackName}\n${parts.join("\n")}` : `${fallbackName}: done.`;
  }
  return template.replace(/\{(\w+(?:\.\w+)*)\}/g, (_, path: string) => {
    const val = path.split(".").reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), data);
    if (val === undefined || val === null) return "—";
    // Format large integers with thousands separators (money reads better).
    if (typeof val === "number" && Number.isInteger(val) && Math.abs(val) >= 1000) return val.toLocaleString("en-US");
    return String(val);
  });
}

function humanize(k: string): string {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

/** Render a numbered capability menu + the ordered action ids behind it. */
function numberedMenu(actions: IntentAction[]): { text: string; ids: string[] } {
  const top = actions.slice(0, 8);
  return { text: top.map((a, i) => `${i + 1}. ${a.name}`).join("\n"), ids: top.map((a) => a.id) };
}

/** The "reply with a number, or just tell me what you need" suffix appended
 *  after a greeting/reset/link — omitted entirely for a tenant with zero
 *  configured actions (e.g. a pure-FAQ tenant), since there's no real menu
 *  to reply to a number FOR. Real bug found live 2026-08-22: 4 separate
 *  call sites each hand-rolled this same template unconditionally, so a
 *  zero-capability tenant got "Reply with a number..." followed by a blank
 *  menu on every greeting after the first — same "never hint at a menu
 *  that doesn't exist" discipline as smallTalk()'s equivalent fix
 *  (ai.ts), just missed here since these paths don't go through
 *  smallTalk() at all. One shared helper instead of 4 hand-rolled copies
 *  so a 5th call site can't reintroduce the same gap. */
function menuPrompt(menu: { text: string; ids: string[] }, lead = "Reply with a number, or just tell me what you need:"): string {
  return menu.ids.length > 0 ? `\n\n${lead}\n${menu.text}` : "";
}

/** Build OTP challenge messages. On real channels (WhatsApp/SMS) the code is
 *  delivered as an actual message so the user receives it; the web simulator
 *  gets a styled demo hint. Names the registered person for reassurance. */
function buildOtpReplies(channelType: string, code: string, registeredName?: string): Reply[] {
  const who = registeredName ? `This number is registered to *${registeredName}*. ` : "";
  const prompt = `🔐 ${who}For your security, please enter the 6-digit code we just sent to confirm it's you.`;
  if (channelType === "webchat") {
    return [{ body: prompt }, { kind: "otp_hint", body: `Demo only — your code is ${code}.` }];
  }
  return [{ body: prompt }, { body: `Your verification code is: ${code}\n(expires in 5 minutes)` }];
}

// Website widget (Phase 8e, 2026-08-20, explicit user decision): OTP step-up
// is blocked entirely on this channel rather than weakened to a visible
// "demo hint" — live testing found the widget has no real second channel to
// deliver a code to (unlike WhatsApp, where receiving the code on that
// number IS the proof), so a code would just be echoed back to the same
// browser session that asked for it, verifying nothing. Points the visitor
// at the org's real WhatsApp number when one exists, so this is a genuine
// next step, not a dead end.
async function widgetOtpBlockedMessage(tenantId: string, actionPhrase: string): Promise<string> {
  const number = await db.whatsAppNumber.findFirst({ where: { tenantId, status: "active" }, orderBy: { createdAt: "asc" } });
  const via = number?.phoneNumber ? ` on WhatsApp (${number.phoneNumber})` : " on WhatsApp";
  return `For your security, we can't ${actionPhrase} through this website chat yet — please message us${via} instead, or contact us directly.`;
}

// ── Self-service onboarding for unknown contacts ────────────────────────────

type Onboarding = { idLabel: string; grantKey: string; roleKey: string; office: string; audience: string };

/** Industry-based defaults for how a new contact identifies themselves. */
function onboardingFor(industry: string): Onboarding | null {
  const m: Record<string, Onboarding> = {
    business: { idLabel: "Employee ID", grantKey: "employees", roleKey: "employee", office: "HR", audience: "employees" },
    school: { idLabel: "child's admission number", grantKey: "students", roleKey: "parent", office: "the school office", audience: "parents" },
    hospital: { idLabel: "patient number", grantKey: "patients", roleKey: "patient", office: "reception", audience: "patients" },
  };
  return m[industry] ?? null;
}

/** Link a verified contact to their record: set the grant + assign the role. */
async function linkContact(tenantId: string, contactId: string, ob: Onboarding, personId: string, name: string): Promise<void> {
  await db.contact.update({
    where: { id: contactId },
    data: { displayName: name, phoneVerified: true, grants: { [ob.grantKey]: [{ id: personId, name }] } as object },
  });
  const role = await db.role.findUnique({ where: { tenantId_key: { tenantId, key: ob.roleKey } } });
  if (role) {
    await db.contactRole.upsert({
      where: { contactId_roleId: { contactId, roleId: role.id } },
      create: { contactId, roleId: role.id },
      update: {},
    });
  }
}

/** Fill {key} placeholders from a flat record (used for confirmation prompts). */
function fillTemplate(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = values[k];
    return v === undefined || v === null || v === "" ? "—" : String(v);
  });
}
