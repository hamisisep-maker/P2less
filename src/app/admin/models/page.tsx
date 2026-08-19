import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { InfoTip } from "@/components/dashboard-ui";
import { requireAdminPermission } from "@/lib/admin-authz";
import { AddPricingForm } from "./pricing-form";

export default async function AdminModelsPage() {
  await requireAdminPermission("models.view");
  const [byModel, byFeature, allPricing] = await Promise.all([
    db.aiRequestLog.groupBy({ by: ["provider", "model"], _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costKes: true, revenueKes: true } }),
    db.aiRequestLog.groupBy({ by: ["feature"], _count: { _all: true }, _sum: { costKes: true, revenueKes: true } }),
    db.modelPricing.findMany({ orderBy: { effectiveFrom: "desc" } }),
  ]);

  // Most recent (currently effective) price per provider/model.
  const currentPrice = new Map<string, { input: number; output: number; effectiveFrom: Date }>();
  for (const p of allPricing) {
    const key = `${p.provider}/${p.model}`;
    if (!currentPrice.has(key)) currentPrice.set(key, { input: p.inputPerMillionUsd, output: p.outputPerMillionUsd, effectiveFrom: p.effectiveFrom });
  }

  const modelRows = byModel
    .map((m) => {
      const key = `${m.provider}/${m.model}`;
      const cost = m._sum.costKes ?? 0;
      const revenue = m._sum.revenueKes ?? 0;
      return {
        key, provider: m.provider, model: m.model,
        calls: m._count._all,
        inputTokens: m._sum.inputTokens ?? 0,
        outputTokens: m._sum.outputTokens ?? 0,
        costKes: cost, revenueKes: revenue, profitKes: revenue - cost,
        price: currentPrice.get(key),
      };
    })
    .sort((a, b) => b.calls - a.calls);

  const totalCost = modelRows.reduce((s, m) => s + m.costKes, 0);
  const totalRevenue = modelRows.reduce((s, m) => s + m.revenueKes, 0);

  return (
    <div>
      <PageHeader title="Models" subtitle="Real per-request token pricing — which models are used, what they cost, and whether each one is profitable." />

      <Card className="p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Set model pricing</h2>
          <InfoTip text="Versioned — setting a new price never overwrites the old one. Past requests keep using whatever price was in effect when they actually ran, so historical cost figures never silently change." />
        </div>
        <p className="mb-4 text-xs text-muted">Prices are USD per 1 million tokens, matching how every provider publishes their own pricing page. Look up the model's real current price there before setting it here — never guessed.</p>
        <AddPricingForm />
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Model profitability</h2>
          <InfoTip text="Real token usage from AiRequestLog × the price you set above = actual cost. Revenue is what your price_ai_kes setting charges per AI request (see Billing & Revenue), attributed per call." />
        </div>
        <p className="mb-4 text-xs text-muted">
          {modelRows.length === 0
            ? "No AI requests logged yet — this fills in as real traffic flows through."
            : `Across every model: KES ${totalRevenue.toLocaleString("en-US", { maximumFractionDigits: 0 })} revenue attributed vs KES ${totalCost.toLocaleString("en-US", { maximumFractionDigits: 2 })} actual cost.`}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-faint">
                <th className="border-b border-line px-3 py-2">Model</th>
                <th className="border-b border-line px-3 py-2">Calls</th>
                <th className="border-b border-line px-3 py-2">Tokens (in/out)</th>
                <th className="border-b border-line px-3 py-2">Current price ($/1M)</th>
                <th className="border-b border-line px-3 py-2">Cost</th>
                <th className="border-b border-line px-3 py-2">Revenue</th>
                <th className="border-b border-line px-3 py-2">Profit</th>
              </tr>
            </thead>
            <tbody>
              {modelRows.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">No data yet.</td></tr>}
              {modelRows.map((m) => (
                <tr key={m.key} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2.5"><span className="font-medium">{m.model}</span><span className="ml-1.5 text-xs text-faint">({m.provider})</span></td>
                  <td className="px-3 py-2.5">{m.calls}</td>
                  <td className="px-3 py-2.5 text-muted">{m.inputTokens.toLocaleString("en-US")} / {m.outputTokens.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2.5 text-muted">{m.price ? `$${m.price.input} / $${m.price.output}` : <Badge tone="amber">not priced</Badge>}</td>
                  <td className="px-3 py-2.5">KES {m.costKes.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2.5">KES {m.revenueKes.toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                  <td className="px-3 py-2.5"><Badge tone={m.profitKes >= 0 ? "green" : "rose"}>{m.profitKes >= 0 ? "+" : ""}KES {m.profitKes.toLocaleString("en-US", { maximumFractionDigits: 0 })}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Cost by feature</h2>
          <InfoTip text="Which part of the assistant is actually spending the AI budget — order-taking, small talk, intent understanding, etc." />
        </div>
        <div className="space-y-2">
          {byFeature.length === 0 && <p className="text-sm text-muted">No data yet.</p>}
          {byFeature.sort((a, b) => (b._sum.costKes ?? 0) - (a._sum.costKes ?? 0)).map((f) => (
            <div key={f.feature} className="flex items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm">
              <span className="font-medium capitalize">{f.feature.replace(/_/g, " ")}</span>
              <span className="text-muted">{f._count._all} calls · KES {(f._sum.costKes ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
