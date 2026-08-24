import { db } from "@/lib/db";
import { withAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader, Badge } from "@/components/ui";
import { UnmatchedRow } from "./unmatched-row";
import { UnknownPaymentRow } from "./unknown-payment-row";
import { ManualEntryForm } from "./manual-entry-form";

const CHANNEL_LABELS: Record<string, string> = {
  mpesa_stk: "M-Pesa STK Push", mpesa_paybill: "M-Pesa PayBill", mpesa_till: "M-Pesa Till", bank_transfer: "Bank transfer", card: "Card",
};

export default async function AdminReconciliationPage() {
  return withAdminPermission("reconciliation.view", async () => {
    const [channels, unmatched, unknownPayments, tenants] = await Promise.all([
      db.paymentChannel.findMany({ include: { integration: true }, orderBy: { key: "asc" } }),
      db.unmatchedTransaction.findMany({ where: { status: "unmatched" }, orderBy: { occurredAt: "desc" } }),
      db.payment.findMany({ where: { status: "unknown" }, include: { tenant: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
      db.tenant.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const unmatchedTotal = unmatched.reduce((s, t) => s + t.amount, 0);

    return (
      <div>
        <PageHeader
          title="Payment Operations & Reconciliation"
          subtitle="Every payment channel tracked independently — a channel going quiet is not the same as a payment failing."
        />

        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Payment channels</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => {
              const ok = c.integration.lastCheckOk;
              const tone = !c.integration.enabled ? "neutral" : ok === true ? "green" : ok === false ? "rose" : "amber";
              const label = !c.integration.enabled ? "disabled" : ok === true ? "operational" : ok === false ? "unhealthy" : "not configured";
              return (
                <div key={c.key} className="flex items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
                  <div>
                    <span className="font-medium">{CHANNEL_LABELS[c.key] ?? c.key}</span>
                    <div className="text-xs text-muted">{c.integration.lastCheckDetail ?? "Not checked yet"}</div>
                  </div>
                  <Badge tone={tone} dot>{label}</Badge>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Card className="p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Unmatched transactions</div>
            <div className="mt-1 font-display text-2xl font-bold">{unmatched.length}</div>
            <div className="mt-0.5 text-xs text-muted">KES {unmatchedTotal.toLocaleString("en-US")} currently unmatched</div>
          </Card>
          <Card className="p-5">
            <div className="text-xs font-medium uppercase tracking-wide text-faint">Payments in unknown state</div>
            <div className="mt-1 font-display text-2xl font-bold">{unknownPayments.length}</div>
            <div className="mt-0.5 text-xs text-muted">Sent, no confirmation received yet — never auto-suspended while unknown</div>
          </Card>
        </div>

        <Card className="mt-4 p-5">
          <h2 className="mb-1 font-display font-semibold">Record a bank/manual transaction</h2>
          <p className="mb-3 text-xs text-muted">Paste what you see on a bank statement or a PayBill/Till confirmation SMS — this creates evidence to match, not a live feed.</p>
          <ManualEntryForm />
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Unmatched transactions</h2>
          {unmatched.length === 0 && <p className="text-sm text-muted">Nothing unmatched right now.</p>}
          <div className="space-y-2">
            {unmatched.map((tx) => (
              <UnmatchedRow
                key={tx.id}
                data={{ id: tx.id, channelKey: tx.channelKey, providerRef: tx.providerRef, amount: tx.amount, currency: tx.currency, occurredAt: tx.occurredAt, senderName: tx.senderName, senderMsisdn: tx.senderMsisdn, reference: tx.reference }}
                tenants={tenants}
              />
            ))}
          </div>
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Payments awaiting confirmation</h2>
          <p className="mb-3 text-xs text-muted">A push was sent and no definitive success/failure has arrived — the customer may still have paid. Never force-resolve without checking.</p>
          {unknownPayments.length === 0 && <p className="text-sm text-muted">Nothing pending resolution.</p>}
          <div className="space-y-2">
            {unknownPayments.map((p) => (
              <UnknownPaymentRow
                key={p.id}
                data={{ id: p.id, reference: p.reference, tenantName: p.tenant.name, amount: p.amount, currency: p.currency, channelKey: p.channelKey, purpose: p.purpose, createdAt: p.createdAt }}
              />
            ))}
          </div>
        </Card>
      </div>
    );
  });
}
