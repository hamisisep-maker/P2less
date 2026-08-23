import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminPermission, hasAdminPermission } from "@/lib/admin-authz";
import { getTenantOperationalSummary, getPaymentEvidence, getCustomerTimeline } from "@/lib/customer-ops";
import { Card, PageHeader, Badge, Stat, timeAgo } from "@/components/ui";
import { UnknownPaymentRow } from "@/app/admin/reconciliation/unknown-payment-row";
import { NewTicketModal } from "@/app/admin/tickets/new-ticket-modal";
import { PaybillReferenceField } from "./paybill-reference-field";

const STATUS_TONE: Record<string, "rose" | "amber" | "indigo" | "green" | "neutral"> = {
  active: "green", trial: "indigo", suspended: "rose", renewal_due: "amber", payment_pending: "amber", grace_period: "amber", cancelled: "neutral",
};

export default async function TenantOperationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const admin = await requireAdminPermission("tenants.view", { tenantId: id });

  const summary = await getTenantOperationalSummary(id);
  if (!summary) notFound();

  const [evidenceRows, timeline] = await Promise.all([
    Promise.all([...summary.billing.pendingPayments, ...summary.billing.unknownPayments].map((p) => getPaymentEvidence(p.id))),
    getCustomerTimeline(id),
  ]);

  return (
    <div>
      <PageHeader
        title={summary.tenant.name}
        subtitle={`${summary.tenant.industry} · ${summary.tenant.slug} · customer since ${summary.tenant.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
        action={hasAdminPermission(admin, "tickets.manage") ? <NewTicketModal tenants={[]} fixedTenant={{ id: summary.tenant.id, name: summary.tenant.name }} triggerLabel="Create ticket" /> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Account status" value={summary.tenant.status} />
        <Stat label="Subscription" value={summary.subscription?.status.replace(/_/g, " ") ?? "none"} sub={summary.subscription?.planName} />
        <Stat label="Renews" value={summary.subscription ? timeAgo(summary.subscription.renewsAt) : "—"} />
        <Stat label="Open tickets" value={summary.tickets.filter((t) => !["resolved", "closed"].includes(t.status)).length} />
      </div>

      {/* ── Subscription & Plan ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Subscription &amp; plan</h2>
        {summary.subscription ? (
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div><Badge tone={STATUS_TONE[summary.subscription.status] ?? "neutral"}>{summary.subscription.status.replace(/_/g, " ")}</Badge> · {summary.subscription.planName}</div>
            <div>Renews {timeAgo(summary.subscription.renewsAt)}{summary.subscription.graceEndsAt ? ` · grace ends ${timeAgo(summary.subscription.graceEndsAt)}` : ""}</div>
            <div>Auto-renew: {summary.subscription.autoRenew ? "on" : "off"} · billing phone: {summary.subscription.billingPhone ?? "not set"}</div>
            <div>Payment attempts: {summary.subscription.paymentAttemptCount}{summary.subscription.paymentFailureReason ? ` · last failure: ${summary.subscription.paymentFailureReason}` : ""}</div>
            <div className="sm:col-span-2">
              <PaybillReferenceField tenantId={summary.tenant.id} initial={summary.subscription.paybillReference} canManage={hasAdminPermission(admin, "billing.confirm_payment")} />
            </div>
            {summary.subscription.reconciliationNeeded && <div className="sm:col-span-2"><Badge tone="amber">Reconciliation needed</Badge></div>}
          </div>
        ) : <p className="text-sm text-muted">No subscription.</p>}
      </Card>

      {/* ── Usage & WhatsApp ── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Usage this month</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Messages in: <b>{summary.usage.messagesIn}</b></div>
            <div>Messages out: <b>{summary.usage.messagesOut}</b></div>
            <div>AI requests: <b>{summary.usage.aiRequests}</b></div>
            <div>Documents: <b>{summary.usage.documents}</b></div>
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">WhatsApp status</h2>
          {summary.whatsapp.numbers.length === 0 && <p className="text-sm text-muted">No WhatsApp number configured.</p>}
          {summary.whatsapp.numbers.map((n) => (
            <div key={n.phoneNumber} className="text-sm">{n.displayName} · {n.phoneNumber} · <Badge tone={n.status === "active" ? "green" : "neutral"}>{n.status}</Badge></div>
          ))}
          <div className="mt-1.5 text-xs text-muted">
            Last inbound {summary.whatsapp.lastInboundAt ? timeAgo(summary.whatsapp.lastInboundAt) : "never"} · last outbound {summary.whatsapp.lastOutboundAt ? timeAgo(summary.whatsapp.lastOutboundAt) : "never"}
          </div>
        </Card>
      </div>

      {/* ── Billing / Payments / Reconciliation (the "Evidence" layer) ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Billing &amp; payments</h2>
        <p className="mb-3 text-xs text-muted">Payment problem → evidence below → reconcile if authorized → subscription consequence shown inline.</p>
        <div className="space-y-2">
          {summary.billing.recentPayments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-soft px-3 py-2 text-sm">
              <div><span className="font-mono text-xs">{p.reference}</span> · {p.currency} {p.amount.toLocaleString("en-US")} · {p.purpose}</div>
              <Badge tone={p.status === "paid" ? "green" : p.status === "failed" ? "rose" : p.status === "unknown" ? "amber" : "neutral"}>{p.status}</Badge>
            </div>
          ))}
          {summary.billing.recentPayments.length === 0 && <p className="text-sm text-muted">No payments yet.</p>}
        </div>

        {evidenceRows.filter((e) => e !== null).length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Payments awaiting confirmation — evidence</h3>
            <div className="space-y-2">
              {evidenceRows.filter((e) => e !== null).map((e) => (
                <div key={e!.payment.id} className="rounded-xl border border-amber/30 bg-amber-soft/20 px-3.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div><span className="font-mono text-sm">{e!.payment.reference}</span> · {e!.payment.currency} {e!.payment.amount.toLocaleString("en-US")}</div>
                    <Badge tone={e!.reconciliationStatus === "unknown" ? "amber" : "neutral"}>{e!.reconciliationStatus}</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                    <div>Payment initiated: <b>{e!.initiatedAt.toLocaleTimeString("en-GB")}</b></div>
                    <div>STK request: <b>{e!.stkRequest.status}</b></div>
                    <div>Callback: <b>{e!.callback.received ? `received ${timeAgo(e!.callback.receivedAt!)}` : "not received"}</b></div>
                    <div>Reconciliation status: <b>{e!.reconciliationStatus}</b></div>
                    <div>Subscription action: <b>{e!.subscriptionConsequence ?? "none"}</b></div>
                    <div>Tenant service: <b>{e!.tenantServiceStatus?.tenantStatus ?? "unknown"}</b></div>
                  </div>
                  <div className="mt-1.5 text-xs italic text-muted">Reason: {e!.reason}</div>
                  {e!.reconciliationStatus === "unknown" && hasAdminPermission(admin, "reconciliation.match") && (
                    <div className="mt-2">
                      <UnknownPaymentRow data={{ id: e!.payment.id, reference: e!.payment.reference, tenantName: summary.tenant.name, amount: e!.payment.amount, currency: e!.payment.currency, channelKey: e!.payment.channelKey, purpose: e!.payment.purpose, createdAt: e!.payment.createdAt }} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {summary.billing.unmatchedTransactions.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Unmatched transactions</h3>
            {summary.billing.unmatchedTransactions.map((u) => (
              <div key={u.id} className="text-sm text-muted">{u.channelKey} · {u.providerRef} · KES {u.amount} · {timeAgo(u.occurredAt)}</div>
            ))}
          </div>
        )}
      </Card>

      {/* ── AI usage ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">AI usage</h2>
        <div className="mb-2 text-sm">Cost this month: <b>KES {summary.ai.costThisMonthKes.toFixed(2)}</b></div>
        <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
          {summary.ai.modelsUsed.map((m) => <Badge key={`${m.provider}-${m.model}`} tone="indigo">{m.provider}/{m.model} × {m.count}</Badge>)}
          {summary.ai.modelsUsed.length === 0 && <span className="text-muted">No AI usage this month.</span>}
        </div>
        {summary.ai.recentFailures.length > 0 && (
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-rose">Recent errors</h3>
            {summary.ai.recentFailures.map((f, i) => (
              <div key={i} className="text-xs text-muted">{f.provider}/{f.model} · {f.errorSnippet ?? "unknown error"} · {timeAgo(f.createdAt)}</div>
            ))}
          </div>
        )}
      </Card>

      {/* ── System: relevant incidents ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">System &amp; incidents</h2>
        <p className="mb-3 text-xs text-muted">Incidents are platform-wide — P2Less doesn&apos;t yet track which tenants depend on which integration, so this matches on the channels/WhatsApp this tenant actually uses, plus any critical incident regardless of source (labeled).</p>
        {summary.system.relevantIncidents.length === 0 && <p className="text-sm text-muted">No relevant open incidents.</p>}
        <div className="space-y-1.5">
          {summary.system.relevantIncidents.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs">{i.number ?? i.id.slice(0, 8)}</span>
              <Badge tone={i.severity === "critical" ? "rose" : "amber"}>{i.severity}</Badge>
              <span>{i.title}</span>
              {i.isPlatformWide && <Badge tone="neutral">platform-wide, may not affect this tenant</Badge>}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Staff — real gap found 2026-08-23, no headcount/activity existed here at all ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Staff — {summary.staff.filter((u) => u.active).length} active now, {summary.staff.length} total</h2>
        <div className="space-y-2">
          {summary.staff.map((u) => (
            <div key={u.id} className="flex items-center justify-between rounded-xl border border-line-soft px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge tone={u.active ? "green" : "neutral"} dot>{u.active ? "active now" : "offline"}</Badge>
                <span className="font-medium">{u.name}</span>
                <span className="text-xs text-muted">{u.email}</span>
              </div>
              <div className="flex gap-1">{u.roles.map((r) => <Badge key={r} tone="accent">{r}</Badge>)}</div>
            </div>
          ))}
          {summary.staff.length === 0 && <p className="text-xs text-muted">No staff yet.</p>}
        </div>
      </Card>

      {/* ── Security ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Security</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-faint uppercase">Recent sessions</h3>
            {summary.security.recentSessions.map((s, i) => <div key={i} className="text-xs text-muted">{s.userName} · {s.ip ?? "unknown ip"} · {timeAgo(s.createdAt)}{s.revokedAt ? " · revoked" : ""}</div>)}
            {summary.security.recentSessions.length === 0 && <p className="text-xs text-muted">None.</p>}
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold text-faint uppercase">Admin actions on this tenant</h3>
            {summary.security.adminActions.map((a, i) => <div key={i} className="text-xs text-muted">{a.action} · {timeAgo(a.createdAt)}</div>)}
            {summary.security.adminActions.length === 0 && <p className="text-xs text-muted">None.</p>}
          </div>
        </div>
      </Card>

      {/* ── Support tickets ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Support tickets</h2>
        {summary.tickets.length === 0 && <p className="text-sm text-muted">No tickets for this tenant.</p>}
        <div className="space-y-1.5">
          {summary.tickets.map((t) => (
            <Link key={t.id} href={`/admin/tickets/${t.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-2">
              <span className="font-mono text-xs">{t.number ?? t.id.slice(0, 8)}</span>
              <Badge tone={["resolved", "closed"].includes(t.status) ? "green" : "rose"}>{t.status.replace(/_/g, " ")}</Badge>
              <span>{t.subject}</span>
            </Link>
          ))}
        </div>
      </Card>

      {/* ── Audit: complete timeline ── */}
      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Customer timeline</h2>
        <p className="mb-3 text-xs text-muted">Composed live from real records (audit log, payments, callbacks, messages, tickets, receipts) — not a separate log kept in sync by hand.</p>
        {timeline.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
        <div className="max-h-[32rem] space-y-1 overflow-y-auto">
          {timeline.map((e, i) => (
            <div key={i} className="flex items-baseline gap-3 border-l-2 border-line-soft py-1 pl-3 text-sm">
              <span className="w-16 shrink-0 font-mono text-xs text-faint">{e.at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
              <span>{e.label}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
