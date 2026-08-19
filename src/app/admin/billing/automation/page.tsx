import Link from "next/link";
import { ArrowLeft, Bell, Send, ShieldOff, AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { IconStat, InfoTip } from "@/components/dashboard-ui";
import { getAllSettings } from "@/lib/platform-settings";
import { AutomationForm } from "./automation-form";
import { RulesTable, type RuleRow } from "./rules-table";
import { AddRuleForm } from "./add-rule-form";
import { RunNowButton } from "./run-now-button";
import { ReconciliationRow } from "./reconciliation-card";

export default async function BillingAutomationPage() {
  const now = new Date();
  const settings = await getAllSettings();
  const graceDays = Number(settings.billing_grace_period_days);

  const [rules, expiringSoon, gracePeriod, paymentPending, reconciliationNeeded, scheduledSuspensions] = await Promise.all([
    db.notificationRule.findMany({ orderBy: [{ event: "asc" }, { channel: "asc" }] }),
    db.subscription.count({ where: { status: { in: ["active", "renewal_due"] }, renewsAt: { lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } } }),
    db.subscription.findMany({ where: { status: "grace_period" }, include: { tenant: true } }),
    db.subscription.count({ where: { status: "payment_pending" } }),
    db.subscription.findMany({ where: { reconciliationNeeded: true }, include: { tenant: true } }),
    db.subscription.count({ where: { status: "grace_period", graceEndsAt: { lte: now } } }),
  ]);

  const ruleRows: RuleRow[] = rules.map((r) => ({ id: r.id, event: r.event, channel: r.channel, timingDays: r.timingDays, enabled: r.enabled }));

  return (
    <div>
      <Link href="/admin/billing" className="mb-3 flex items-center gap-1.5 text-xs text-muted hover:text-accent"><ArrowLeft size={13} /> Back to Billing & Revenue</Link>
      <PageHeader
        title="Billing automation"
        subtitle="Reminders, automated renewal charges, grace periods, and suspension — configured here, not scattered through code."
        action={<RunNowButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IconStat icon={<Bell size={17} />} label="Expiring within 7 days" value={expiringSoon} tip="Subscriptions renewing soon — reminders queue automatically per the rules below." tone="accent" />
        <IconStat icon={<Send size={17} />} label="Payment pending" value={paymentPending} tip="Automated renewal charge sent, waiting for M-Pesa confirmation." tone="indigo" />
        <IconStat icon={<ShieldOff size={17} />} label="In grace period" value={gracePeriod.length} tip={`Retries exhausted — service continues for up to ${graceDays} more day(s) before auto-suspend.`} tone="amber" />
        <IconStat icon={<AlertTriangle size={17} />} label="Needs reconciliation" value={reconciliationNeeded.length} tip="No payment webhook received in time — status unknown, will NOT auto-suspend until a human resolves it." tone="rose" />
      </div>

      {reconciliationNeeded.length > 0 && (
        <Card className="mt-4 p-5">
          <div className="mb-1 flex items-center gap-1.5">
            <h2 className="font-display font-semibold">Needs reconciliation</h2>
            <InfoTip text="These tenants had a renewal charge sent but no definitive payment result came back in time. The billing engine deliberately stops touching them until you resolve it — this is the safety mechanism against blind auto-suspension." />
          </div>
          <div className="space-y-2">
            {reconciliationNeeded.map((s) => <ReconciliationRow key={s.tenantId} tenantId={s.tenantId} tenantName={s.tenant.name} />)}
          </div>
        </Card>
      )}

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Next automated actions</h2>
        <p className="mb-3 text-xs text-muted">A live preview of what the billing engine will do on its next cycle (runs automatically every 15 minutes).</p>
        <ul className="space-y-1.5 text-sm">
          <li>• <b>{expiringSoon}</b> subscription(s) expire within 7 days — reminders scheduled per the rules below</li>
          <li>• <b>{paymentPending}</b> tenant(s) currently awaiting a renewal payment confirmation</li>
          <li>• <b>{gracePeriod.length}</b> tenant(s) in their grace period{gracePeriod.length > 0 ? `: ${gracePeriod.map((g) => g.tenant.name).join(", ")}` : ""}</li>
          <li>• <b>{scheduledSuspensions}</b> tenant(s) will be <span className="text-rose">auto-suspended</span> on the next cycle (grace period already ended)</li>
        </ul>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Automation settings</h2>
          <InfoTip text="These drive the state machine in billing-lifecycle.ts — no code change needed to adjust grace periods, retry behavior, or the safety kill-switches." />
        </div>
        <AutomationForm initial={settings} />
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 font-display font-semibold">Notification rules</h2>
        <p className="mb-3 text-xs text-muted">Each rule fires independently — e.g. an email reminder at 7 days AND a WhatsApp reminder at 3 days for the same renewal. Channels without a connected provider (email, SMS) are logged honestly as queued rather than faked as sent — see the Integrations status once that's wired in.</p>
        <RulesTable rules={ruleRows} />
        <div className="mt-4 border-t border-line-soft pt-4">
          <AddRuleForm />
        </div>
      </Card>
    </div>
  );
}
