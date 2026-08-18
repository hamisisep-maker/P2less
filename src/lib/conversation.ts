import "server-only";
import { db } from "./db";
import { understand, humanizeReply, smallTalk, complete, aiEnabled, partOfDay, type ChatTurn } from "./ai";
import { executeAction, type ParamSpec } from "./connector-engine";
import { issueOtp, verifyOtp, hasVerifiedSession } from "./otp";
import { hasPermission } from "./permissions";
import { audit } from "./audit";
import { meter, checkLimit } from "./usage";
import { deliver } from "./transport";
import { generateReportCard, generatePayslipPdf, generateLeavePdf, generateFeeStatementPdf, generateCvPdf, type GeneratedDoc } from "./documents";
import { isCvRequest, extractCvData } from "./cv-writer";
import { requestId as newRequestId, randomToken } from "./crypto";
import { isCatalogBrowseRequest, isOrderRequest, formatCatalog, matchProduct, extractQuantity, startOrderPayment, findExactProductMention, hasExplicitQuantity, isProductImageRequest } from "./catalog";
import { dispatchWebhook } from "./webhooks";
import { extractDate, extractTime, isGreeting, type IntentAction } from "./intent-engine";
import { pickTool, allTools } from "./tools";
import { startTopup, creditRateKes, creditsForAmount } from "./wallet";
import { isConfigured as mpesaConfigured } from "./mpesa";

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
  toNumber: string; // the ORGANIZATION number the user messaged — the routing key
  fromNumber: string; // the sender's number — an identity signal, never sufficient alone
  channelType: string; // whatsapp | webchat | sms (transport only)
  text: string;
  displayName?: string;
  // Super-app: an attached file (document/spreadsheet/image) to run a tool on.
  attachment?: { base64: string; filename: string; mimeType: string };
};

export type Reply = { body: string; kind?: "text" | "otp_hint" | "document" | "system"; meta?: Record<string, unknown>; document?: { url: string; filename: string } };
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
  // A product order awaiting CONFIRM before the real M-Pesa charge fires.
  pendingOrder?: { productId: string; productName: string; quantity: number; unitPrice: number; currency: string };
  // The most recently PLACED order (pending payment or paid) — kept in context so
  // a follow-up question right after ("which number did you send it to?") can be
  // answered from real data instead of the AI having nothing to go on and
  // denying the order ever happened.
  lastOrder?: { reference: string; productName: string; quantity: number; total: number; currency: string; phone: string; status: "pending_payment" | "paid" };
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

// A resource the contact is authorized to reference — a student, employee,
// patient, order, member, etc. The grants JSON holds arrays keyed by type.
type ResourceGrant = { id: string; name: string; grade?: string; [k: string]: unknown };
type LastResource = { id: string; name: string; grade?: string; grantKey?: string };

/** Canonicalize a phone/address to E.164 with a leading "+". WhatsApp delivers
 *  senders without the "+"; stored contacts keep it — this makes them match. */
function normalizePhone(n: string): string {
  const t = n.trim();
  if (t.startsWith("+")) return "+" + t.slice(1).replace(/[^\d]/g, "");
  const digits = t.replace(/[^\d]/g, "");
  // Only treat it as a phone number if it's all digits (leave chat ids alone).
  return digits === t.replace(/[\s-]/g, "") && digits.length >= 7 ? "+" + digits : t;
}

export async function handleInbound(input: InboundInput): Promise<HandleResult> {
  const reqId = newRequestId();

  // ── ROUTING: the destination number → organization number → tenant. ──────
  // The user messaged the organization's own number; P2Less resolves which
  // tenant owns that number. This is the heart of the platform.
  const number = await db.whatsAppNumber.findUnique({
    where: { phoneNumber: input.toNumber },
    include: { tenant: { include: { subscription: true } } },
  });
  if (!number || number.status !== "active" || number.tenant.status === "suspended") {
    // Unknown/inactive number: nothing to reply as, and no tenant to bill/audit.
    return { ok: false, replies: [{ body: "This number is not in service." }] };
  }
  const tenant = number.tenant;

  // The identity the user sees is the ORGANIZATION (per-number branding wins).
  const numBranding = (number.branding as { assistantName?: string; welcome?: string } | null) ?? {};
  const tenantBranding = (tenant.branding as { assistantName?: string; welcome?: string; poweredBy?: string } | null) ?? {};
  const branding = { ...tenantBranding, ...numBranding };
  const assistant = number.displayName; // e.g. "Hamzone Technologies"
  const fromIdentity = { number: number.phoneNumber, name: number.displayName };

  // Identity: resolve/create the contact (scoped to THIS tenant) by sender number.
  // Normalize to canonical E.164 so a WhatsApp sender ("254739536255") and a
  // stored contact ("+254739536255") resolve to the same person across channels.
  const senderAddress = normalizePhone(input.fromNumber);
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

  // A conversation is per (contact, organization number).
  let conversation = await db.conversation.findFirst({
    where: { tenantId: tenant.id, contactId: contact.id, numberId: number.id, status: { not: "closed" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { tenantId: tenant.id, contactId: contact.id, numberId: number.id, status: "open", context: {} },
    });
  }

  // Record inbound + meter (enforce message limits).
  const limit = await checkLimit(tenant.id, "message_in");
  await db.message.create({ data: { tenantId: tenant.id, conversationId: conversation.id, direction: "in", body: input.text } });
  await meter(tenant.id, "message_in");
  void dispatchWebhook(tenant.id, "message.received", { conversationId: conversation.id, from: input.fromNumber, to: input.toNumber, text: input.text }).catch(() => {});
  if (!limit.ok) {
    const reply: Reply = { body: "This service has reached its monthly message limit. Please contact the organization." };
    await deliver({ tenantId: tenant.id, conversationId: conversation.id, channelType: input.channelType, to: input.fromNumber, body: reply.body, fromNumberId: number.phoneNumberId });
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
  const knownFacts = buildKnownFacts(contact.displayName, grants, ctx.lastOrder);
  // Org-approved FAQs (school hours, term dates, payment methods…). The org owns
  // these; the AI may answer from them verbatim but never invents beyond them.
  const orgFaqs = ((tenant.faqs as { q: string; a: string }[] | null) ?? []).filter((f) => f && f.q && f.a);

  const emit = async (replies: Reply[], status: string, nextCtx: ConvContext) => {
    await db.conversation.update({ where: { id: conversation!.id }, data: { status, context: nextCtx as object } });
    for (const r of replies) {
      // otp_hint / system notes are demo aids and are not re-metered as separate sends
      if (r.kind === "otp_hint" || r.kind === "system") continue;
      await deliver({ tenantId: tenant.id, conversationId: conversation!.id, channelType: input.channelType, to: input.fromNumber, body: r.body, meta: r.meta, fromNumberId: number.phoneNumberId, document: r.document });
    }
    return { ok: true, replies, conversationId: conversation!.id, from: fromIdentity } satisfies HandleResult;
  };

  // Send ONE message right now, mid-turn — before slow work (reading a document,
  // writing a CV) starts — so the person sees "I'm on it" instead of long silence
  // followed by typing dots. Does NOT touch conversation status/context; the
  // final emit() at the end of this turn still owns that.
  const announceNow = async (body: string) => {
    await deliver({ tenantId: tenant.id, conversationId: conversation!.id, channelType: input.channelType, to: input.fromNumber, body, fromNumberId: number.phoneNumberId });
  };

  const text = input.text.trim();
  const lower = text.toLowerCase();

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
      : `Okay, starting fresh. 👋 Reply with a number or just tell me what you need:\n${m.text}`;
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
    return emit([{ body: `${hi}\n\nReply with a number, or just tell me what you need:\n${menu.text}` }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
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
    if (!codeMatch && /(resend|new code|another code|where.*(code|is it)|did ?n.?t|have ?n.?t|not receiv|no code|send.*again|try again)/i.test(lower)) {
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
        return emit([{ body: `✅ Verified — welcome, ${pl.name.split(" ")[0]}! Your number is now linked to ${assistant}.\n\nReply with a number, or just ask:\n${caps.text}` }], "open", { menu: caps.ids });
      }
      // Case 2: OTP gated a sensitive action → resume it now.
      const resumed = await runAction({
        tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history,
        actionId: ctx.pendingActionId!, resolved: ctx.pendingResolved ?? {}, alreadyConfirmed: false,
        lastResource: ctx.lastResource,
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
    const negate = isDirectReply(lower, negateWords);
    const affirm = isDirectReply(lower, affirmWords);
    if (negate) {
      return emit([{ body: "No problem — I've cancelled that. Anything else I can help with?" }], "open", { lastResource: ctx.lastResource });
    }
    if (affirm) {
      const resumed = await runAction({
        tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history,
        actionId: ctx.pendingActionId, resolved: ctx.pendingResolved ?? {}, alreadyConfirmed: true,
        lastResource: ctx.lastResource,
      });
      return emit(resumed.replies, resumed.status, resumed.ctx);
    }
    // Don't robotically repeat "reply CONFIRM". The user might change their mind,
    // ask something else, or just chat. Follow a genuine new request; otherwise
    // answer naturally and then remind them the booking is still waiting.
    const actionsNow = await loadActions(tenant.id);
    const reroute = await understand(text, actionsNow, history);
    if (reroute.actionId && reroute.score >= 0.6 && reroute.actionKey !== ctx.pendingActionKey) {
      const cBase: CollectBase = { tenantId: tenant.id, reqId, contact, permissions, grants, assistant, channelType: input.channelType, contactName: contact.displayName ?? undefined, userText: text, history };
      const run = await dispatchAction(cBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
      return emit(run.replies, run.status, run.ctx);
    }
    const stc = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
    // Same anti-nag rule: push-back or a second stray message drops the pending
    // confirmation instead of repeating "reply CONFIRM" forever.
    const cAsides = (ctx.paramAsides ?? 0) + 1;
    if (PUSHBACK.test(lower) || cAsides >= 2) {
      return emit([{ body: stc ?? "No problem — I've set that aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
    }
    const remind = "Whenever you're ready, reply CONFIRM to go ahead, or CANCEL to drop it.";
    return emit([{ body: stc ? `${stc}\n\n${remind}` : `Please reply CONFIRM to proceed, or CANCEL to stop.` }], "awaiting_confirm", { ...ctx, paramAsides: cAsides });
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
      if (isOverviewRequest(lower)) {
        const target = await resolveOverviewTarget(text, grants, tenant.id, ctx.lastResource);
        if (target && !("ask" in target)) {
          const ov = await runOverview(collectBase, target.grantKey, target.student);
          return emit(ov.replies, ov.status, ov.ctx);
        }
      }
      const reroute = await understand(text, actionsNow, history);
      if (reroute.actionId && reroute.score >= 0.55 && reroute.actionKey !== ctx.pendingActionKey) {
        // Genuine topic switch → abandon the half-filled flow and follow them.
        const run = await dispatchAction(collectBase, reroute.actionId, reroute.entities, { lastResource: ctx.lastResource });
        return emit(run.replies, run.status, run.ctx);
      }
      // Push-back ("I didn't ask for this", "date for what?") or a second stray
      // message → STOP nagging. Abandon the flow and just answer them. Only a
      // genuine first-time aside keeps the booking alive (with a skippable hint).
      const asides = (ctx.paramAsides ?? 0) + 1;
      const pushback = PUSHBACK.test(lower);
      const st = aiEnabled() ? await smallTalk(assistant, text, [...actionsNow.map((a) => a.name), ...toolCapabilityLines()], history, knownFacts, orgFaqs) : null;
      if (pushback || asides >= 2) {
        return emit([{ body: st ?? "No problem — I've set that aside. How can I help you?" }], "open", { lastResource: ctx.lastResource });
      }
      const reask = `${promptFor(expected)}\n\n(Or just say "cancel" if you didn't mean to start this.)`;
      return emit([{ body: st ? `${st}\n\n${reask}` : reask }], "awaiting_param", { ...ctx, paramAsides: asides });
    }
    const value = resolveEntityFromText(expected, text);
    const resolved = { ...(ctx.pendingResolved ?? {}), [ctx.missingParam]: value };
    // "next tuesday at 2pm" answers BOTH date and time — capture every date/time
    // entity present in the one message so we don't re-ask for what they gave.
    const pAction = await db.connectorAction.findUnique({ where: { id: ctx.pendingActionId } });
    for (const spec of ((pAction?.paramSchema as unknown as ParamSpec[]) ?? [])) {
      if (spec.from !== "entity") continue;
      const ent = spec.entity ?? spec.name;
      if (resolved[spec.name] !== undefined && resolved[spec.name] !== "") continue;
      if (ent === "date" || ent === "startDate" || ent === "endDate") { const d = extractDate(text); if (d) resolved[spec.name] = d; }
      else if (ent === "time") { const t = extractTime(text); if (t) resolved[spec.name] = t; }
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
    if (/^(cancel|stop|no|nevermind|never mind)$/i.test(lower)) {
      return emit([{ body: "No problem — say “hi” whenever you'd like to get connected." }], "open", {});
    }
    const ob0 = onboardingFor(tenant.industry);
    // A greeting or "help" here means re-explain, not "that's a bad ID".
    if (ob0 && (isGreeting(text) || /^help\b/.test(lower))) {
      return emit([{ body: `👋 To connect you, just reply with your ${ob0.idLabel} — the one ${ob0.office} has on file for you. Or reply CANCEL.` }], "awaiting_identify", {});
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
  if (conversation.status === "awaiting_order_quantity" && ctx.pendingOrder) {
    const po = ctx.pendingOrder;
    if (isDirectReply(lower, /\b(cancel|no|nope|nah|stop|don'?t)\b/i)) {
      return emit([{ body: "No problem — order cancelled. Let me know if you'd like anything else!" }], "open", { lastResource: ctx.lastResource });
    }
    if (!hasExplicitQuantity(text)) {
      // Still didn't say a number — ask again rather than guessing.
      return emit([{ body: `Sorry, how many ${po.productName} would you like? (Just the number, e.g. "2")` }], "awaiting_order_quantity", ctx);
    }
    const qty = extractQuantity(text);
    const total = po.unitPrice * qty;
    return emit(
      [{ body: `${qty} × ${po.productName} = ${po.currency} ${total.toLocaleString("en-US")}. Reply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }],
      "awaiting_order_confirm",
      { pendingOrder: { ...po, quantity: qty } },
    );
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
      const total = po.unitPrice * po.quantity;
      const reference = "ORD-" + randomToken(4).toUpperCase();
      const order = await db.order.create({
        data: { tenantId: tenant.id, contactId: contact.id, reference, totalAmount: total, currency: po.currency, status: "pending", items: { create: [{ productId: po.productId, quantity: po.quantity, unitPrice: po.unitPrice, name: po.productName }] } },
      });
      const res = await startOrderPayment({ tenantId: tenant.id, orderId: order.id, phone: senderAddress, amountKes: total, reference });
      if (!res.ok) return emit([{ body: `Couldn't start payment: ${res.error}. Reply CONFIRM to try again, or CANCEL to stop.` }], "awaiting_order_confirm", ctx);
      if (res.mock) {
        const lastOrder: ConvContext["lastOrder"] = { reference, productName: po.productName, quantity: po.quantity, total, currency: po.currency, phone: senderAddress, status: "paid" };
        return emit([{ body: `✅ Payment received (demo mode — no real M-Pesa configured)! Order ${reference} confirmed: ${po.quantity} × ${po.productName}. Thank you! 🎉` }], "open", { lastOrder });
      }
      // Keep this order in context (NOT wiped to {}) so an immediate follow-up
      // question ("which number did you send it to?") can be answered from real
      // data — without this the AI has nothing to go on and denies the order
      // ever happened, which is exactly the kind of hallucination we must avoid.
      const lastOrder: ConvContext["lastOrder"] = { reference, productName: po.productName, quantity: po.quantity, total, currency: po.currency, phone: senderAddress, status: "pending_payment" };
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
      const total = updated.unitPrice * newQty;
      return emit(
        [{ body: `Updated: ${newQty} × ${updated.productName} = ${updated.currency} ${total.toLocaleString("en-US")}. Reply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }],
        "awaiting_order_confirm",
        { pendingOrder: updated },
      );
    }
    const total = po.unitPrice * po.quantity;
    const stc = aiEnabled() ? await smallTalk(assistant, text, [], history, knownFacts, orgFaqs) : null;
    const remind = `${po.quantity} × ${po.productName} = ${po.currency} ${total.toLocaleString("en-US")}. Reply CONFIRM to pay via M-Pesa, or CANCEL to stop.`;
    return emit([{ body: stc ? `${stc}\n\n${remind}` : remind }], "awaiting_order_confirm", ctx);
  }
  if (isProductImageRequest(lower)) {
    // Only relevant for a tenant that actually sells things — otherwise this is
    // about something else entirely ("photo of the campus") and should fall
    // through to normal handling instead of talking about a nonexistent catalog.
    const hasCatalog = (await db.product.count({ where: { tenantId: tenant.id, active: true } })) > 0;
    if (hasCatalog) {
      return emit([{ body: "We don't have photos of our products uploaded yet — happy to describe any of them, or you can ask about price, sizes, or anything else!" }], "open", ctx);
    }
  }
  if (isCatalogBrowseRequest(lower)) {
    const products = await db.product.findMany({ where: { tenantId: tenant.id, active: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
    if (products.length > 0) return emit([{ body: formatCatalog(assistant, products) }], "open", ctx);
    // No catalog set up for this org — fall through to normal handling (e.g. FAQs/smallTalk).
  }
  if (isOrderRequest(lower)) {
    const products = await db.product.findMany({ where: { tenantId: tenant.id, active: true, inStock: true } });
    if (products.length > 0) {
      const { hit, candidates } = matchProduct(text, products);
      if (candidates) {
        const list = candidates.map((c, i) => `${i + 1}. ${c.name} — ${c.currency} ${c.price.toLocaleString("en-US")}`).join("\n");
        return emit([{ body: `I found a few matches — which one did you mean?\n${list}` }], "open", ctx);
      }
      if (hit) {
        // Acknowledge a discount/negotiation request honestly instead of
        // silently proceeding at full price as if they never asked.
        const askedDiscount = /\b(discount|cheaper|lower price|reduce|bargain|deal|offer)\b/i.test(lower);
        const prefix = askedDiscount ? "We don't have discounts set up for this right now. " : "";
        // Never silently assume a quantity — ASK when they didn't say one.
        if (!hasExplicitQuantity(text)) {
          return emit(
            [{ body: `${prefix}How many ${hit.name} would you like?` }],
            "awaiting_order_quantity",
            { pendingOrder: { productId: hit.id, productName: hit.name, quantity: 0, unitPrice: hit.price, currency: hit.currency } },
          );
        }
        const qty = extractQuantity(text);
        const total = hit.price * qty;
        return emit(
          [{ body: `${prefix}${qty} × ${hit.name} = ${hit.currency} ${total.toLocaleString("en-US")}. Reply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }],
          "awaiting_order_confirm",
          { pendingOrder: { productId: hit.id, productName: hit.name, quantity: qty, unitPrice: hit.price, currency: hit.currency } },
        );
      }
      // Mentioned buying something but nothing matched a real product — offer the catalog instead of a dead end.
      return emit([{ body: `I couldn't match that to something we sell. ${formatCatalog(assistant, products)}` }], "open", ctx);
    }
    // Org sells nothing (no products set up) — fall through to normal handling.
  } else if (!/\?/.test(lower) && text.trim().split(/\s+/).length <= 4) {
    // No buy verb, but a short message might STILL just be a bare product name
    // ("mitumba") — check for an exact match before letting free-form AI chat
    // improvise a fake "how many would you like?" exchange that has no real
    // order behind it. Silent no-op if nothing matches (never dumps the catalog
    // here — that's reserved for explicit buy intent above).
    const products = await db.product.findMany({ where: { tenantId: tenant.id, active: true, inStock: true } });
    const hit = findExactProductMention(text, products);
    if (hit) {
      if (!hasExplicitQuantity(text)) {
        return emit(
          [{ body: `How many ${hit.name} would you like?` }],
          "awaiting_order_quantity",
          { pendingOrder: { productId: hit.id, productName: hit.name, quantity: 0, unitPrice: hit.price, currency: hit.currency } },
        );
      }
      const qty = extractQuantity(text);
      const total = hit.price * qty;
      return emit(
        [{ body: `${qty} × ${hit.name} = ${hit.currency} ${total.toLocaleString("en-US")}. Reply CONFIRM to pay via M-Pesa, or CANCEL to stop.` }],
        "awaiting_order_confirm",
        { pendingOrder: { productId: hit.id, productName: hit.name, quantity: qty, unitPrice: hit.price, currency: hit.currency } },
      );
    }
  }

  // ── Unknown contact → warm welcome + self-service linking, never a cold "no" ─
  if (contact.contactRoles.length === 0) {
    const ob = onboardingFor(tenant.industry);
    const identify = await db.connectorAction.findFirst({ where: { key: "IDENTIFY", connector: { tenantId: tenant.id, status: "active" } } });
    const caps = numberedMenu(await loadActions(tenant.id)).text;
    const hello = branding.welcome ?? `👋 Hello! You've reached ${assistant}.`;
    if (ob && identify) {
      return emit([{ body: `${hello}\n\nI can help ${ob.audience} with things like:\n${caps}\n\nI don't recognize this number yet. To connect you securely, reply with your ${ob.idLabel} — the one ${ob.office} has on file for you.` }], "awaiting_identify", {});
    }
    return emit([{ body: `${hello}\n\nI can help ${ob?.audience ?? "registered users"} with things like:\n${caps}\n\nI don't recognize this number yet — please contact ${ob?.office ?? "the organization"} to get set up.` }], "open", {});
  }

  // ── Greetings / help / escalation ───────────────────────────────────────
  // Only treat it as a greeting if that's ALL it is (computed above). "hey, how
  // much do I owe?" opens with a greeting but carries a real request, so it falls
  // through to intent detection instead of bouncing back the menu.
  if (pureGreeting) {
    const menu = numberedMenu(await loadActions(tenant.id));
    const first = (contact.displayName ?? "").split(" ")[0];
    const hi = first
      ? `Good ${partOfDay()}, ${first}! 👋 Welcome back to ${assistant}.`
      : `Good ${partOfDay()}! 👋 ${branding.welcome ?? `Welcome to ${assistant}.`}`;
    return emit([{ body: `${hi}\n\nReply with a number, or just tell me what you need:\n${menu.text}` }], "open", { lastResource: ctx.lastResource, menu: menu.ids });
  }
  if (/(speak|talk).*(human|someone|agent|person)|human agent|customer care/.test(lower)) {
    await db.supportTicket.create({ data: { tenantId: tenant.id, conversationId: conversation.id, subject: `Escalation from ${contact.displayName ?? input.fromNumber}` } });
    await audit({ tenantId: tenant.id, requestId: reqId, actorType: "contact", actorId: contact.id, action: "escalate", success: true });
    return emit([{ body: "I've created a support request and notified the team. Someone will get back to you shortly." }], "escalated", { lastResource: ctx.lastResource });
  }

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
  if (actions.length === 0) {
    return emit([{ body: "This organization hasn't connected any systems yet." }], "open", ctx);
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
    // Fallback ONLY if the AI is truly unavailable (after retries). Keep it warm
    // and ask, rather than cold-dumping the menu. A friendly remark gets a warm
    // ack; anything else gets a gentle "tell me more" with the menu as a backup.
    const first = (contact.displayName ?? "").split(" ")[0];
    const fallback = isSocialChit(lower)
      ? warmAck(text)
      : `I want to make sure I get you the right thing${first ? `, ${first}` : ""} 😊 Could you tell me a little more about what you need? For example, checking attendance, exam results, a fee balance, booking an appointment, or sending me a spreadsheet to analyze — or reply with a number:\n${menu.text}`;
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
        return { replies: [{ body: `I found more than one match. Please tell me which one:\n${list}` }], status: "open", ctx: prevCtx };
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
      return { replies: [{ body: `Which ${noun} do you mean?\n${list}` }], status: "open", ctx: prevCtx };
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
  return allTools().map((t) => `${t.name} — ${t.description} (the user just needs to SEND the file, no need to ask first)`);
}

function buildKnownFacts(displayName: string | null | undefined, grants: Record<string, ResourceGrant[]>, lastOrder?: ConvContext["lastOrder"]): string {
  const lines: string[] = [];
  if (displayName) lines.push(`- The CONTACT you're chatting with (their own name) is ${displayName}.`);
  else lines.push(`- We do not have the CONTACT's own name on file — do not guess or assign them one.`);
  for (const [key, items] of Object.entries(grants)) {
    const names = (items ?? []).map((g) => resourceLabel(g)).filter(Boolean);
    // Explicit so the model never conflates the contact with their dependent —
    // a parent is NOT their child, an HR contact is NOT the employee, etc.
    if (names.length) lines.push(`- Linked ${key} (these are records the CONTACT looks after / is associated with — NOT the contact's own identity): ${names.join(", ")}.`);
  }
  if (lastOrder) {
    const statusText = lastOrder.status === "paid" ? "paid" : "an M-Pesa payment prompt was sent to this number and we're waiting for them to enter their PIN";
    lines.push(`- Their most recent order (this really happened, it is NOT a test or a mistake — state it as fact if asked): ${lastOrder.quantity} × ${lastOrder.productName} = ${lastOrder.currency} ${lastOrder.total.toLocaleString("en-US")}, reference ${lastOrder.reference}, STK push sent to ${lastOrder.phone}, status: ${statusText}.`);
  }
  return lines.join("\n");
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
};

async function runAction(args: RunArgs): Promise<{ replies: Reply[]; status: string; ctx: ConvContext }> {
  const { tenantId, reqId, contact, permissions, grants } = args;
  const action = await db.connectorAction.findUnique({ where: { id: args.actionId }, include: { connector: true } });
  if (!action) return { replies: [{ body: "That capability is not available." }], status: "open", ctx: { lastResource: args.lastResource } };

  const baseCtx: ConvContext = { lastResource: args.lastResource };

  // 1. Permission check
  if (!hasPermission(permissions, action.requiredPermission)) {
    await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "authz.deny", target: action.key, success: false, detail: { reason: "permission" } });
    return { replies: [{ body: "You don't have permission to access that." }], status: "open", ctx: baseCtx };
  }

  // 2. Resource-level authorization (IDOR guard): the target id must be in the
  //    contact's grants for the configured resource type.
  if (action.resourceGrantKey && action.resourceParam) {
    const targetId = args.resolved[action.resourceParam];
    const allowed = (grants as Record<string, ResourceGrant[] | undefined>)[action.resourceGrantKey] ?? [];
    const ok = allowed.some((g) => g.id === targetId);
    if (!ok) {
      await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "authz.deny", target: action.key, success: false, detail: { reason: "resource", targetId } });
      return { replies: [{ body: "You're not authorized to view that record." }], status: "open", ctx: baseCtx };
    }
  }

  // 3. Step-up authentication for sensitive actions
  if (action.requiresStepUp && !(await hasVerifiedSession(contact.id))) {
    const issued = await issueOtp(tenantId, contact.id);
    if ("error" in issued) return { replies: [{ body: issued.error }], status: "open", ctx: baseCtx };
    await audit({ tenantId, requestId: reqId, actorType: "contact", actorId: contact.id, action: "otp.issue", target: action.key, success: true });
    return {
      replies: buildOtpReplies(args.channelType, issued.code, args.contactName),
      status: "awaiting_otp",
      ctx: { ...baseCtx, pendingActionId: action.id, pendingActionKey: action.key, pendingResolved: args.resolved, otpChallengeId: issued.challengeId },
    };
  }

  // 4. Confirmation for write actions — echo back exactly what will happen.
  if (action.requiresConfirm && !args.alreadyConfirmed) {
    const values = { ...args.resolved, resourceName: args.lastResource?.name ?? "", studentName: args.lastResource?.name ?? "" };
    const summary = action.confirmTemplate ? fillTemplate(action.confirmTemplate, values) : (action.description ?? action.name);
    return {
      replies: [{ body: `${summary}\n\nReply CONFIRM to proceed, or CANCEL to stop.` }],
      status: "awaiting_confirm",
      ctx: { ...baseCtx, pendingActionId: action.id, pendingActionKey: action.key, pendingResolved: args.resolved },
    };
  }

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

  // 7. Optional document generation + secure delivery (as a real PDF/file)
  if (action.documentKind) {
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

  return { replies, status: "open", ctx: baseCtx };
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
