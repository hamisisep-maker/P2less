import { Wallet, Receipt, TrendingUp, PackageX } from "lucide-react";
import { requireTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Badge } from "@/components/ui";
import { PageHeader } from "@/components/ui";
import { IconStat, SimpleAreaChart, OrdersTable, InfoTip, type OrderRow } from "@/components/dashboard-ui";

export const dynamic = "force-dynamic";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function SalesPage() {
  const user = await requireTenantUser();
  const tenantId = user.tenantId!;

  const [revenueAgg, lowStock, recentOrders, paidOrdersForChart, paidItems] = await Promise.all([
    db.order.aggregate({ where: { tenantId, status: "paid" }, _sum: { totalAmount: true }, _count: true }),
    db.product.findMany({ where: { tenantId, active: true, stockQuantity: { not: null, lte: 5 } }, orderBy: { stockQuantity: "asc" } }),
    db.order.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 25, include: { contact: true, items: true } }),
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
  const days: { date: string; revenue: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = dayKey(d);
    days.push({ date: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }), revenue: byDay.get(k) ?? 0 });
  }

  const byProduct = new Map<string, { units: number; revenue: number }>();
  for (const item of paidItems) {
    const cur = byProduct.get(item.name) ?? { units: 0, revenue: 0 };
    cur.units += item.quantity;
    cur.revenue += item.quantity * item.unitPrice;
    byProduct.set(item.name, cur);
  }
  const topProducts = [...byProduct.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 8);
  const maxProductRevenue = Math.max(1, ...topProducts.map(([, s]) => s.revenue));

  const orderRows: OrderRow[] = recentOrders.map((o) => ({
    id: o.id,
    reference: o.reference,
    items: o.items.map((i) => `${i.quantity}× ${i.name}`).join(", "),
    amount: `${o.currency} ${o.totalAmount.toLocaleString("en-US")}`,
    status: o.status,
    created: o.createdAt,
  }));

  return (
    <div>
      <PageHeader title="Sales" subtitle="Real revenue, orders, and stock across every product sold through WhatsApp." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <IconStat icon={<Wallet size={17} />} label="Total revenue" value={totalRevenue} tip="All-time, paid orders only (KES)." tone="accent" />
        <IconStat icon={<Receipt size={17} />} label="Paid orders" value={paidCount} tip="All-time count of successfully paid orders." tone="indigo" />
        <IconStat icon={<TrendingUp size={17} />} label="Average order" value={avgOrder} tip="Total revenue divided by paid orders (KES)." tone="amber" />
        <IconStat icon={<PackageX size={17} />} label="Low / out of stock" value={lowStock.length} tip="Active products at 5 units or fewer." tone="rose" />
      </div>

      <Card className="mt-4 p-5">
        <div className="mb-1 flex items-center gap-1.5">
          <h2 className="font-display font-semibold">Revenue — last 14 days</h2>
          <InfoTip text="Sum of paid-order totals per day (KES)." />
        </div>
        <SimpleAreaChart data={days} dataKey="revenue" name="Revenue (KES)" color="var(--color-accent)" />
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Top products</h2>
          {topProducts.length === 0 && <p className="text-sm text-muted">No paid orders yet.</p>}
          <div className="space-y-3">
            {topProducts.map(([name, s]) => (
              <div key={name}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="min-w-0 truncate pr-2 font-medium">{name}</span>
                  <span className="shrink-0 text-xs text-muted">{s.units} sold · KES {s.revenue.toLocaleString("en-US")}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--color-accent-2))]" style={{ width: `${Math.max(4, (s.revenue / maxProductRevenue) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-display font-semibold">Low / out of stock</h2>
          {lowStock.length === 0 && <p className="text-sm text-muted">Nothing running low right now.</p>}
          <div className="space-y-2">
            {lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-line-soft px-3 py-2 text-sm">
                <span className="min-w-0 truncate pr-2">{p.name}</span>
                <Badge tone={p.stockQuantity === 0 ? "rose" : "amber"} dot>{p.stockQuantity === 0 ? "Out of stock" : `${p.stockQuantity} left`}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-display font-semibold">Recent orders</h2>
        <OrdersTable data={orderRows} />
      </Card>
    </div>
  );
}
