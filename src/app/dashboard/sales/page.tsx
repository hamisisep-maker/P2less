import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Stat, PageHeader, Badge } from "@/components/ui";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Plain SVG bar chart — no charting library, this is the only place that needs one.
function RevenueChart({ days }: { days: { label: string; total: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.total));
  const w = 640;
  const h = 160;
  const barGap = 4;
  const barW = days.length ? (w - barGap * (days.length - 1)) / days.length : 0;
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} className="w-full" role="img" aria-label="Revenue over the last 14 days">
      {days.map((d, i) => {
        const barH = Math.round((d.total / max) * (h - 8));
        const x = i * (barW + barGap);
        const y = h - barH;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={barH} rx={3} className="fill-[var(--color-accent)]" opacity={d.total > 0 ? 1 : 0.15} />
            {i % 2 === 0 && (
              <text x={x + barW / 2} y={h + 16} textAnchor="middle" className="fill-[var(--color-faint)]" style={{ fontSize: 9 }}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default async function SalesPage() {
  const user = await requireTenantUser();
  const tenantId = user.tenantId!;

  const [revenueAgg, lowStock, recentOrders, paidOrdersForChart, paidItems] = await Promise.all([
    db.order.aggregate({ where: { tenantId, status: "paid" }, _sum: { totalAmount: true }, _count: true }),
    db.product.findMany({ where: { tenantId, active: true, stockQuantity: { not: null, lte: 5 } }, orderBy: { stockQuantity: "asc" } }),
    db.order.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 10, include: { contact: true, items: true } }),
    db.order.findMany({ where: { tenantId, status: "paid" }, select: { totalAmount: true, paidAt: true } }),
    db.orderItem.findMany({ where: { order: { tenantId, status: "paid" } }, select: { name: true, quantity: true, unitPrice: true } }),
  ]);

  const totalRevenue = revenueAgg._sum.totalAmount ?? 0;
  const paidCount = revenueAgg._count;
  const avgOrder = paidCount > 0 ? Math.round(totalRevenue / paidCount) : 0;

  // Last 14 days, oldest first, zero-filled for days with no sales.
  const byDay = new Map<string, number>();
  for (const o of paidOrdersForChart) {
    if (!o.paidAt) continue;
    const k = dayKey(o.paidAt);
    byDay.set(k, (byDay.get(k) ?? 0) + o.totalAmount);
  }
  const days: { label: string; total: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    days.push({ label: d.toLocaleDateString("en-US", { day: "numeric", month: "short" }), total: byDay.get(k) ?? 0 });
  }

  const byProduct = new Map<string, { units: number; revenue: number }>();
  for (const item of paidItems) {
    const cur = byProduct.get(item.name) ?? { units: 0, revenue: 0 };
    cur.units += item.quantity;
    cur.revenue += item.quantity * item.unitPrice;
    byProduct.set(item.name, cur);
  }
  const topProducts = [...byProduct.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);

  const statusTone: Record<string, "green" | "amber" | "rose" | "neutral"> = { paid: "green", pending: "amber", failed: "rose", cancelled: "neutral" };

  return (
    <div>
      <PageHeader title="Sales" subtitle="Real revenue, orders, and stock across every product sold through WhatsApp." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total revenue" value={`KES ${totalRevenue.toLocaleString("en-US")}`} sub="all-time, paid orders" />
        <Stat label="Paid orders" value={paidCount} sub="all-time" />
        <Stat label="Average order" value={`KES ${avgOrder.toLocaleString("en-US")}`} sub="per paid order" />
        <Stat label="Low / out of stock" value={lowStock.length} sub="products to restock" />
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Revenue — last 14 days</h2>
        <RevenueChart days={days} />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Top products</h2>
          {topProducts.length === 0 && <p className="text-sm text-muted">No paid orders yet.</p>}
          <div className="space-y-2">
            {topProducts.map(([name, s]) => (
              <div key={name} className="flex items-center justify-between text-sm">
                <span className="min-w-0 truncate pr-2">{name}</span>
                <span className="shrink-0 text-muted">{s.units} sold · KES {s.revenue.toLocaleString("en-US")}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">Low / out of stock</h2>
          {lowStock.length === 0 && <p className="text-sm text-muted">Nothing running low right now.</p>}
          <div className="space-y-2">
            {lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="min-w-0 truncate pr-2">{p.name}</span>
                <Badge tone={p.stockQuantity === 0 ? "rose" : "amber"}>{p.stockQuantity === 0 ? "Out of stock" : `${p.stockQuantity} left`}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Recent orders</h2>
        {recentOrders.length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
        <div className="space-y-2">
          {recentOrders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft pb-2 text-sm last:border-0 last:pb-0">
              <div className="min-w-0">
                <span className="font-medium">{o.reference}</span>
                <span className="ml-2 text-muted">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-muted">{o.currency} {o.totalAmount.toLocaleString("en-US")}</span>
                <Badge tone={statusTone[o.status] ?? "neutral"}>{o.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
