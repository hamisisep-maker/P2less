import "server-only";
import { db } from "./db";
import { mpesaFailureCategoryLabel } from "./mpesa";

// ─────────────────────────────────────────────────────────────────────────────
// The Customer Operations Centre's read layer — "open the customer, see
// everything the platform already knows" instead of asking them. Every field
// here is composed from tables that already exist (Subscription, Payment,
// AiRequestLog/AiCallEvent, Message, AuditLog, UsageEvent, SupportTicket) —
// nothing is duplicated into a new cache. See incident-detection.ts's own
// "common operational event/health model" rule, which this follows exactly.
// ─────────────────────────────────────────────────────────────────────────────

function monthStart(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type TenantOperationalSummary = Awaited<ReturnType<typeof getTenantOperationalSummary>>;

export async function getTenantOperationalSummary(tenantId: string) {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, include: { subscription: { include: { plan: true } } } });
  if (!tenant) return null;

  const since = monthStart();

  const [
    usageEvents, numbers, lastIn, lastOut,
    recentPayments, pendingPayments, unknownPayments, unmatchedTransactions,
    recentAiRequests, recentAiFailures, aiCostAgg, aiModelsUsed,
    recentTickets, staffUsers,
  ] = await Promise.all([
    db.usageEvent.groupBy({ by: ["type"], where: { tenantId, createdAt: { gte: since } }, _sum: { quantity: true } }),
    db.whatsAppNumber.findMany({ where: { tenantId } }),
    db.message.findFirst({ where: { tenantId, direction: "in" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.message.findFirst({ where: { tenantId, direction: "out" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.payment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.payment.findMany({ where: { tenantId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db.payment.findMany({ where: { tenantId, status: "unknown" }, orderBy: { createdAt: "desc" } }),
    db.unmatchedTransaction.findMany({ where: { matchedTenantId: tenantId, status: "unmatched" } }),
    db.aiRequestLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.aiCallEvent.findMany({ where: { tenantId, ok: false }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.aiRequestLog.aggregate({ where: { tenantId, createdAt: { gte: since } }, _sum: { costKes: true } }),
    db.aiRequestLog.groupBy({ by: ["provider", "model"], where: { tenantId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.supportTicket.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.user.findMany({ where: { tenantId }, select: { id: true, name: true, email: true, createdAt: true, userRoles: { include: { role: true } } }, orderBy: { createdAt: "asc" } }),
  ]);

  // Security: UserSession/LoginAttempt aren't tenantId-columns directly —
  // sessions join via User.tenantId (already have staffUsers), LoginAttempt
  // is keyed by email, so join via this tenant's staff emails.
  const staffUserIds = staffUsers.map((u) => u.id);
  const staffEmails = staffUsers.map((u) => u.email);
  const [recentSessions, activeSessions, recentLoginAttempts, adminActions] = await Promise.all([
    staffUserIds.length ? db.userSession.findMany({ where: { userId: { in: staffUserIds } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    // Real gap found 2026-08-23 (asked directly, "so we can trace incase of
    // anything"): the ip/timestamp session list below had no user attached
    // at all — an admin investigating a tenant couldn't tell WHICH staff
    // member a session belonged to. Same "active in the last 15 min" query
    // as the admin overview's own "Right now" stat (src/app/admin/page.tsx).
    staffUserIds.length ? db.userSession.findMany({ where: { userId: { in: staffUserIds }, lastActiveAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, revokedAt: null, expiresAt: { gt: new Date() } }, distinct: ["userId"], select: { userId: true } }) : [],
    staffEmails.length ? db.loginAttempt.findMany({ where: { email: { in: staffEmails } }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    db.auditLog.findMany({ where: { tenantId, action: { startsWith: "admin." } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));
  const activeStaffIds = new Set(activeSessions.map((s) => s.userId));

  // "Relevant outages" — honest, not fake tenant-specificity. Incident has no
  // tenant attribution (platform-wide only), so this matches on the
  // integration keys this tenant actually depends on (its payment channels +
  // WhatsApp, if it has a number) plus AI (provider selection is
  // platform-wide, so any AI incident could affect this tenant's
  // conversations) plus any unresolved CRITICAL incident regardless of
  // source (a DB/infra-wide incident affects everyone) — labeled as such in
  // the UI, never presented as if P2Less tracks a real per-tenant dependency
  // graph it doesn't have.
  const usedChannelKeys = [...new Set(recentPayments.map((p) => p.channelKey).filter((k): k is string => !!k))];
  const relevantKeys = [...usedChannelKeys, ...(numbers.length ? ["whatsapp_cloud_api"] : [])];
  const relevantIncidents = await db.incident.findMany({
    where: {
      status: { not: "resolved" },
      OR: [
        { relatedIntegrationKey: { in: relevantKeys } },
        { source: { in: relevantKeys } },
        { relatedIntegrationKey: { startsWith: "ai_" } },
        { severity: "critical" },
      ],
    },
    orderBy: { lastDetectedAt: "desc" },
    take: 10,
  });

  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, industry: tenant.industry, status: tenant.status, createdAt: tenant.createdAt },
    subscription: tenant.subscription
      ? {
          status: tenant.subscription.status, planName: tenant.subscription.plan.name, renewsAt: tenant.subscription.renewsAt,
          graceEndsAt: tenant.subscription.graceEndsAt, paymentAttemptCount: tenant.subscription.paymentAttemptCount,
          paymentFailureReason: tenant.subscription.paymentFailureReason, reconciliationNeeded: tenant.subscription.reconciliationNeeded,
          billingPhone: tenant.subscription.billingPhone, autoRenew: tenant.subscription.autoRenew,
          paybillReference: tenant.subscription.paybillReference,
        }
      : null,
    usage: {
      messagesIn: usageEvents.find((u) => u.type === "message_in")?._sum.quantity ?? 0,
      messagesOut: usageEvents.find((u) => u.type === "message_out")?._sum.quantity ?? 0,
      aiRequests: usageEvents.find((u) => u.type === "ai_request")?._sum.quantity ?? 0,
      documents: usageEvents.find((u) => u.type === "document")?._sum.quantity ?? 0,
    },
    whatsapp: {
      numbers: numbers.map((n) => ({ phoneNumber: n.phoneNumber, displayName: n.displayName, status: n.status, verificationStatus: n.verificationStatus })),
      lastInboundAt: lastIn?.createdAt ?? null,
      lastOutboundAt: lastOut?.createdAt ?? null,
    },
    billing: {
      recentPayments: recentPayments.map((p) => ({ id: p.id, reference: p.reference, amount: p.amount, currency: p.currency, purpose: p.purpose, channelKey: p.channelKey, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt, failureCategory: p.failureCategory })),
      pendingPayments: pendingPayments.map((p) => ({ id: p.id, reference: p.reference, amount: p.amount, currency: p.currency, purpose: p.purpose, channelKey: p.channelKey, createdAt: p.createdAt })),
      unknownPayments: unknownPayments.map((p) => ({ id: p.id, reference: p.reference, amount: p.amount, currency: p.currency, purpose: p.purpose, channelKey: p.channelKey, createdAt: p.createdAt })),
      unmatchedTransactions: unmatchedTransactions.map((u) => ({ id: u.id, channelKey: u.channelKey, providerRef: u.providerRef, amount: u.amount, occurredAt: u.occurredAt })),
    },
    ai: {
      recentRequests: recentAiRequests.map((r) => ({ provider: r.provider, model: r.model, feature: r.feature, costKes: r.costKes, success: r.success, createdAt: r.createdAt })),
      recentFailures: recentAiFailures.map((f) => ({ provider: f.provider, model: f.model, errorSnippet: f.errorSnippet, createdAt: f.createdAt })),
      costThisMonthKes: aiCostAgg._sum.costKes ?? 0,
      modelsUsed: aiModelsUsed.map((m) => ({ provider: m.provider, model: m.model, count: m._count._all })),
    },
    system: {
      relevantIncidents: relevantIncidents.map((i) => ({ id: i.id, number: i.number, severity: i.severity, source: i.source, title: i.title, status: i.status, isPlatformWide: !relevantKeys.includes(i.relatedIntegrationKey ?? "") && !relevantKeys.includes(i.source) })),
    },
    security: {
      recentSessions: recentSessions.map((s) => ({ userName: staffNameById.get(s.userId) ?? "Former staff member", ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt, lastActiveAt: s.lastActiveAt, revokedAt: s.revokedAt })),
      recentLoginAttempts: recentLoginAttempts.map((l) => ({ email: l.email, success: l.success, ip: l.ip, createdAt: l.createdAt })),
      adminActions: adminActions.map((a) => ({ action: a.action, target: a.target, actorId: a.actorId, reason: a.reason, createdAt: a.createdAt })),
    },
    // Real gap found 2026-08-23 (asked directly): the admin tenant page had
    // no staff headcount or active status at all — team-invites (dashboard
    // side) made this matter, since there can now be more than one person.
    staff: staffUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, roles: u.userRoles.map((ur) => ur.role.name), active: activeStaffIds.has(u.id), createdAt: u.createdAt })),
    tickets: recentTickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, createdAt: t.createdAt })),
  };
}

export type CustomerTimelineEvent = { at: Date; label: string; source: string; detail?: unknown };

function humanizeAuditAction(action: string): string {
  return action.replace(/^billing\./, "").replace(/^admin\./, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** "09:41 Payment initiated → 09:41 STK sent → 09:42 Callback received →
 *  09:42 Payment confirmed → 09:42 Subscription renewed → 09:42 Receipt
 *  generated → 09:43 WhatsApp service active → 10:12 Customer opened
 *  support ticket." A REAL-TIME COMPOSED QUERY, not a new table — every one
 *  of these facts already lives in AuditLog (the backbone: billing-lifecycle.ts
 *  already calls audit() at payment_confirmed/renewed/auto_suspended/etc.),
 *  Payment, InboundEvent, Message, SupportTicket/TicketEvent, or Document.
 *  Building a new TimelineEvent table here would be the exact anti-pattern
 *  the operational-event-model rule elsewhere in this codebase exists to
 *  prevent. One honest gap: there's no distinct "STK sent" timestamp
 *  anywhere — Payment.createdAt IS effectively that moment (the row is
 *  created at send time, before any callback) — rendered as one event, not
 *  force-split into two to match an example's exact step count. */
export async function getCustomerTimeline(tenantId: string): Promise<CustomerTimelineEvent[]> {
  const [auditRows, payments, inboundEvents, messages, tickets, ticketEvents, receipts] = await Promise.all([
    db.auditLog.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.payment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.inboundEvent.findMany({ where: { relatedTenantId: tenantId }, orderBy: { receivedAt: "desc" }, take: 30 }),
    db.message.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 60 }),
    db.supportTicket.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.ticketEvent.findMany({ where: { ticket: { tenantId } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.document.findMany({ where: { tenantId, kind: "receipt" }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const events: CustomerTimelineEvent[] = [];

  // Payment.paidAt and billing.payment_confirmed both mark the SAME real
  // event — dedupe by reference so it's never rendered twice.
  const confirmedRefs = new Set<string>();
  for (const a of auditRows) {
    // admin.ticket_* actions are ALSO recorded as TicketEvent rows below
    // (ticket-actions.ts writes both) — TicketEvent is the more detailed,
    // authoritative source for ticket lifecycle, so skip the audit-log copy
    // here rather than showing the same real action twice.
    if (a.action.startsWith("admin.ticket_")) continue;
    const d = a.detail as Record<string, unknown> | null;
    const ref = d && typeof d.reference === "string" ? d.reference : null;
    if (a.action === "billing.payment_confirmed" && ref) confirmedRefs.add(ref);
    events.push({ at: a.createdAt, label: humanizeAuditAction(a.action), source: "audit", detail: a.detail });
  }

  for (const p of payments) {
    events.push({ at: p.createdAt, label: `Payment initiated (${p.reference})`, source: "payment" });
    if (p.paidAt && !confirmedRefs.has(p.reference)) {
      events.push({ at: p.paidAt, label: `Payment confirmed (${p.reference})`, source: "payment" });
    }
  }

  for (const e of inboundEvents) {
    events.push({ at: e.receivedAt, label: `Callback received (${e.source})`, source: "inbound_event", detail: { processingStatus: e.processingStatus } });
  }

  for (const r of receipts) events.push({ at: r.createdAt, label: "Receipt generated", source: "document" });

  // Ticket creation itself is represented by TicketEvent{type:"created"}
  // below (both write sites — createTicketAction and the WhatsApp escalation
  // path — always write one) rather than a second synthetic marker here.
  const ticketNumberById = new Map(tickets.map((t) => [t.id, t.number ?? t.id.slice(0, 8)]));
  for (const te of ticketEvents) {
    const label = te.type === "created" ? `Support ticket opened (${ticketNumberById.get(te.ticketId) ?? "?"})` : `Ticket ${te.type.replace(/_/g, " ")} (${ticketNumberById.get(te.ticketId) ?? "?"})`;
    events.push({ at: te.createdAt, label, source: "ticket_event", detail: te.detail });
  }

  // Messages: collapsed into same-direction runs (gap < 30min), never one
  // event per message — a busy tenant would drown the timeline otherwise;
  // full message history stays on the existing conversation view.
  const sortedMsgs = [...messages].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let run: { direction: string; first: Date; last: Date; count: number } | null = null;
  for (const m of sortedMsgs) {
    if (run && run.direction === m.direction && m.createdAt.getTime() - run.last.getTime() < 30 * 60_000) {
      run.last = m.createdAt; run.count++;
    } else {
      if (run) events.push({ at: run.first, label: run.direction === "in" ? `${run.count} WhatsApp message(s) received` : `${run.count} WhatsApp reply/replies sent`, source: "message" });
      run = { direction: m.direction, first: m.createdAt, last: m.createdAt, count: 1 };
    }
  }
  if (run) events.push({ at: run.first, label: run.direction === "in" ? `${run.count} WhatsApp message(s) received` : `${run.count} WhatsApp reply/replies sent`, source: "message" });

  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  return events;
}

export type PaymentEvidence = Awaited<ReturnType<typeof getPaymentEvidence>>;

/** "Payment: Failed" isn't an investigation — this is. Composes the real
 *  chain of evidence for one payment: was the STK request itself accepted
 *  (Payment.providerRef being set post-creation IS that signal — only set
 *  when stkPush() returned ok:true), did a callback ever arrive
 *  (InboundEvent.relatedPaymentId), what did it do to the subscription
 *  (cross-referenced from AuditLog by reference, soft-matched — no hard FK,
 *  same convention used throughout this codebase), and the tenant's current
 *  service status. */
export async function getPaymentEvidence(paymentId: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) return null;

  const isMpesaStk = payment.channelKey === "mpesa_stk";
  let stkRequestStatus: "successful" | "failed" | "n/a" = "n/a";
  let stkRequestDetail = "Not an M-Pesa STK push.";
  if (isMpesaStk) {
    if (payment.status === "failed" && !payment.providerRef) {
      stkRequestStatus = "failed";
      stkRequestDetail = payment.failureReason || "The STK request itself was rejected by Safaricom before any callback could happen.";
    } else {
      stkRequestStatus = "successful";
      stkRequestDetail = "Safaricom accepted the STK push request.";
    }
  }

  const inboundEvent = isMpesaStk
    ? await db.inboundEvent.findFirst({ where: { relatedPaymentId: payment.id }, orderBy: { receivedAt: "desc" } })
    : null;

  const auditRows = await db.auditLog.findMany({ where: { tenantId: payment.tenantId, action: { startsWith: "billing." } }, orderBy: { createdAt: "desc" }, take: 100 });
  const relatedAudit = auditRows.filter((a) => {
    const d = a.detail as Record<string, unknown> | null;
    return !!d && d.reference === payment.reference;
  });

  const tenant = await db.tenant.findUnique({ where: { id: payment.tenantId }, include: { subscription: { select: { status: true } } } });

  const reasonParts: string[] = [];
  if (payment.status === "paid") reasonParts.push("Payment confirmed.");
  else if (payment.status === "failed") reasonParts.push(`Payment failed${payment.failureCategory ? ` (${mpesaFailureCategoryLabel(payment.failureCategory)})` : ""}.`);
  else if (payment.status === "unknown") reasonParts.push("Payment state could not be verified — a request was sent but no definitive success or failure has arrived.");
  else reasonParts.push("Payment is still pending — no response received yet.");
  if (isMpesaStk && stkRequestStatus === "successful" && !inboundEvent && (payment.status === "pending" || payment.status === "unknown")) {
    reasonParts.push("The STK request succeeded but no callback has been received within the reconciliation window.");
  }

  return {
    payment: { id: payment.id, reference: payment.reference, amount: payment.amount, currency: payment.currency, purpose: payment.purpose, channelKey: payment.channelKey, status: payment.status, createdAt: payment.createdAt, paidAt: payment.paidAt, failureCategory: payment.failureCategory, failureReason: payment.failureReason },
    initiatedAt: payment.createdAt,
    stkRequest: { status: stkRequestStatus, detail: stkRequestDetail },
    callback: { received: !!inboundEvent, receivedAt: inboundEvent?.receivedAt ?? null },
    reconciliationStatus: payment.status,
    subscriptionConsequence: relatedAudit.length ? relatedAudit.map((a) => a.action.replace("billing.", "")).join(", ") : null,
    tenantServiceStatus: tenant ? { tenantStatus: tenant.status, subscriptionStatus: tenant.subscription?.status ?? null } : null,
    reason: reasonParts.join(" "),
  };
}
