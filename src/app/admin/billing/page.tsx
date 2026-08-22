import { Wallet, TrendingDown, TrendingUp, PiggyBank } from "lucide-react";
import { db } from "@/lib/db";
import Link from "next/link";
import { Zap } from "lucide-react";
import { Card, PageHeader, timeAgo } from "@/components/ui";
import { IconStat, InfoTip } from "@/components/dashboard-ui";
import { computePlatformPnL, computePlanMargin, loadPricing } from "@/lib/billing";
import { getAllSettings, getSettingsWithMeta, COST_SOURCE, AI_PROVIDER_TOPUP_URL } from "@/lib/platform-settings";
import { requireAdminPermission } from "@/lib/admin-authz";
import { PricingForm } from "./pricing-form";
import { PlanCard, type PlanForCalc } from "./plan-editor";
import { PaymentsTable, type PaymentRow } from "./payments-table";
import { CostReferenceTable, type CostReferenceRow } from "./cost-reference";

export default async function AdminBillingPage() {
  await requireAdminPermission("billing.view");
  const [pnl, settings, plans, payments, pricing, costSettingsMeta, aiProviderConfigs] = await Promise.all([
    computePlatformPnL(),
    getAllSettings(),
    db.plan.findMany({ orderBy: { sort: "asc" } }),
    db.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { tenant: { select: { name: true } } } }),
    loadPricing(),
    getSettingsWithMeta(["cost_conversation_kes", "cost_document_kes", "usd_to_kes_rate"]),
    db.aiProviderConfig.findMany({ orderBy: { provider: "asc" } }),
  ]);

  // Registration/pricing follow-up, 2026-08-22 — "a place that shows current
  // pricing so we don't guess": every EXTERNAL cost assumption in one table,
  // with where it came from and when it was last touched — configured costs
  // read live from the DB, plus known real costs for channels not built yet
  // (X/Twitter), so the gap between "documented in the roadmap" and "visible
  // to whoever's actually setting prices" closes.
  const costReferenceRows: CostReferenceRow[] = [
    {
      label: "WhatsApp conversation (Meta)", value: `KES ${costSettingsMeta.cost_conversation_kes.value}`,
      source: COST_SOURCE.cost_conversation_kes!.source, url: COST_SOURCE.cost_conversation_kes!.url,
      updatedAt: costSettingsMeta.cost_conversation_kes.updatedAt, status: "configured",
    },
    {
      label: "Document generation (compute)", value: `KES ${costSettingsMeta.cost_document_kes.value}`,
      source: COST_SOURCE.cost_document_kes!.source, updatedAt: costSettingsMeta.cost_document_kes.updatedAt, status: "configured",
    },
    {
      label: "USD → KES exchange rate", value: costSettingsMeta.usd_to_kes_rate.value,
      source: COST_SOURCE.usd_to_kes_rate!.source, updatedAt: costSettingsMeta.usd_to_kes_rate.updatedAt, status: "configured",
    },
    ...aiProviderConfigs.map((c) => ({
      label: `AI — ${c.provider}`, value: `KES ${c.costPerCallKes} / call`,
      source: "Admin-set estimate — no provider exposes a live per-call cost API. Verify against real token usage on their billing console.",
      url: AI_PROVIDER_TOPUP_URL[c.provider], updatedAt: c.updatedAt, status: "configured" as const,
    })),
    {
      label: "X (Twitter) — receiving a DM", value: "$0.010 / event",
      source: "Confirmed against X's own pricing docs, 2026-08-22. Not yet an integrated channel — nothing charges against this today.",
      url: "https://docs.x.com/x-api/getting-started/pricing", updatedAt: null, status: "reference-only",
    },
    {
      label: "X (Twitter) — sending a reply", value: "$0.015 / request",
      source: "Confirmed against X's own pricing docs, 2026-08-22. Not yet an integrated channel — nothing charges against this today.",
      url: "https://docs.x.com/x-api/getting-started/pricing", updatedAt: null, status: "reference-only",
    },
  ];

  const planCards: PlanForCalc[] = plans.map((p) => ({
    id: p.id, name: p.name, priceMonthly: p.priceMonthly, active: p.active,
    limits: (p.limits as PlanForCalc["limits"]) ?? {},
    margin: computePlanMargin(p.priceMonthly, (p.limits as PlanForCalc["limits"]) ?? {}, pricing),
  }));

  const paymentRows: PaymentRow[] = payments.map((p) => ({
    id: p.id, reference: p.reference, tenantName: p.tenant.name, amount: p.amount, currency: p.currency,
    method: p.method, purpose: p.purpose, status: p.status, provider: p.provider,
    createdAt: p.createdAt, createdAtLabel: timeAgo(p.createdAt),
  }));

  return (
    <div>
      <PageHeader
        title="Billing & Revenue"
        subtitle="Real payments, platform profit & loss, and whether each plan actually makes money."
        action={<Link href="/admin/billing/automation" className="flex items-center gap-1.5 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-surface-2"><Zap size={15} /> Billing automation</Link>}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IconStat icon={<Wallet size={17} />} label="Revenue this month" value={pnl.revenueThisMonth} tip="Sum of paid Payment records this calendar month (KES)." tone="accent" />
        <IconStat icon={<TrendingDown size={17} />} label="Estimated cost" value={pnl.estimatedCostThisMonth} tip="Meta + AI + document costs this month, from real usage × your cost assumptions below (KES)." tone="amber" />
        <IconStat icon={<PiggyBank size={17} />} label={pnl.aiSpendIsReal ? "AI spend" : "Estimated AI spend"} value={pnl.estimatedAiSpendThisMonth} tip={pnl.aiSpendIsReal ? "Real token usage this month × the per-model pricing set on the Models page (KES) — actual, not estimated." : "No token-level data logged yet this month, so this uses call volume × the flat cost/call from the AI Providers page. Switches to real per-token cost automatically once requests are logged."} tone="indigo" />
        <IconStat
          icon={pnl.estimatedProfitThisMonth >= 0 ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
          label="Estimated profit" value={pnl.estimatedProfitThisMonth}
          tip="Revenue minus estimated cost this month. Negative means you're currently losing money at real usage levels."
          tone={pnl.estimatedProfitThisMonth >= 0 ? "accent" : "rose"}
        />
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Pricing & cost assumptions</h2>
          <InfoTip text="What you charge tenants per unit, and what you estimate it costs P2Less (mainly Meta's WhatsApp fee). These drive every bill and the plan margin calculator below." />
        </div>
        <p className="mb-4 text-xs text-muted">Meta doesn't expose a public real-time billing API for this integration, so the Meta cost figure is an estimate you keep current from your actual Meta invoice — everything downstream (bills, margins, P&L) uses whatever you set here.</p>
        <PricingForm initial={settings} />
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Pricing & cost references</h2>
          <InfoTip text="Where every external cost assumption above actually comes from, and when it was last touched — so you don't have to remember or re-derive it. Includes known real costs for channels not built yet." />
        </div>
        <p className="mb-4 text-xs text-muted">None of these providers expose a live billing-reconciliation API — every number here is a human-verified estimate. &quot;Still on default&quot; means nobody has explicitly confirmed it yet, the likeliest ones to be stale.</p>
        <CostReferenceTable rows={costReferenceRows} />
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Plan profitability</h2>
          <InfoTip text="If a tenant on this plan used every bit of their included limits this month, would you still profit? Calculated from real limits × the pricing above." />
        </div>
        <p className="mb-4 text-xs text-muted">A plan priced below its worst-case cost will lose you money on your heaviest users — edit it here, no code change needed.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {planCards.map((p) => <PlanCard key={p.id} plan={p} />)}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">All payments</h2>
          <InfoTip text="Every payment across every tenant — the record to check if a customer disputes a charge or claims they paid but weren't activated." />
        </div>
        <p className="mb-4 text-xs text-muted">
          <b>Refund</b> marks a paid payment as refunded for accounting/dispute records. It does <b>not</b> automatically move real money back to the customer — M-Pesa reversals go through Safaricom&apos;s separate B2C API, which isn&apos;t wired in here. Actually returning funds is still a manual step outside P2Less until that&apos;s built.
        </p>
        <PaymentsTable data={paymentRows} />
      </Card>
    </div>
  );
}
