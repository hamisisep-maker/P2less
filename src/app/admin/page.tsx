import { requireSuperAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge, Logo } from "@/components/ui";
import {
  IconStat, SimpleAreaChart, TenantsTable, UserMenu, LiveClock, InfoTip,
  type TenantRow,
} from "@/components/dashboard-ui";
import {
  Building2, Layers, MessagesSquare, Send, Sparkles, Zap, Cpu, Waypoints,
  Bot, CircleDot, Rocket, type LucideIcon,
} from "lucide-react";

// Ordered the same way the AI failover chain tries them (see providerChain()
// in ai.ts) — google first, since that's the intended default primary.
const AI_PROVIDERS: { id: string; label: string; keyEnv: string; icon: LucideIcon }[] = [
  { id: "google", label: "Gemini", keyEnv: "GEMINI_API_KEY", icon: Sparkles },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY", icon: Zap },
  { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY", icon: Cpu },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY", icon: Waypoints },
  { id: "anthropic", label: "Claude", keyEnv: "ANTHROPIC_API_KEY", icon: Bot },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY", icon: CircleDot },
  { id: "xai", label: "Grok", keyEnv: "XAI_API_KEY", icon: Rocket },
];

const TZ = process.env.APP_TIMEZONE || "Africa/Nairobi";
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: TZ });
}

export default async function AdminPage() {
  const user = await requireSuperAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const since14 = new Date(); since14.setDate(since14.getDate() - 13); since14.setHours(0, 0, 0, 0);

  const [tenants, plans, totalConvos, totalMsgs, aiStatsToday, growthEvents] = await Promise.all([
    db.tenant.findMany({ include: { subscription: { include: { plan: true } }, _count: { select: { users: true, connectors: true, contacts: true } } }, orderBy: { createdAt: "asc" } }),
    db.plan.findMany({ orderBy: { sort: "asc" } }),
    db.conversation.count(),
    db.usageEvent.aggregate({ where: { type: "message_in" }, _sum: { quantity: true } }),
    db.aiProviderStat.findMany({ where: { date: today } }),
    db.usageEvent.findMany({ where: { type: "message_in", createdAt: { gte: since14 } }, select: { quantity: true, createdAt: true } }),
  ]);
  const configuredPrimary = (process.env.AI_PROVIDER || "").toLowerCase();
  const primaryProvider = AI_PROVIDERS.find((p) => p.id === configuredPrimary && !!process.env[p.keyEnv])?.id
    ?? AI_PROVIDERS.find((p) => !!process.env[p.keyEnv])?.id;

  const buckets = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(since14); d.setDate(d.getDate() + i);
    buckets.set(dayKey(d), 0);
  }
  for (const e of growthEvents) {
    const k = dayKey(e.createdAt);
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + e.quantity);
  }
  const growthData = [...buckets.entries()].map(([date, messages]) => ({ date, messages }));

  const tenantRows: TenantRow[] = tenants.map((t) => ({
    id: t.id, name: t.name, industry: t.industry, plan: t.subscription?.plan.name ?? "no plan",
    status: t.status, users: t._count.users, connectors: t._count.connectors, contacts: t._count.contacts,
  }));

  return (
    <div className="min-h-screen bg-bg">
      {/* Hero header — mirrors the tenant dashboard's dark sidebar palette so
          the super-admin surface reads as its own premium control tower. */}
      <div className="border-b border-side-line bg-side-bg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-10">
          <Logo dark />
          <div className="flex items-center gap-4">
            <div className="hidden sm:block"><LiveClock /></div>
            <UserMenu name={user.name} orgName="Super Admin" logoutAction={logoutAction} />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl p-6 sm:p-10">
        <PageHeader title="Platform administration" subtitle="Every tenant, plan, and AI provider on P2Less — one control tower." />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <IconStat icon={<Building2 size={17} />} label="Tenants" value={tenants.length} tip="Organizations running on P2Less." tone="accent" />
          <IconStat icon={<Layers size={17} />} label="Plans" value={plans.length} tip="Configurable subscription tiers." tone="indigo" />
          <IconStat icon={<MessagesSquare size={17} />} label="Conversations" value={totalConvos} tip="All-time, across every tenant." tone="amber" />
          <IconStat icon={<Send size={17} />} label="Inbound messages" value={totalMsgs._sum.quantity ?? 0} tip="All-time inbound message volume." tone="rose" />
        </div>

        <Card className="mt-4 p-5">
          <div className="mb-1 flex items-center gap-1.5">
            <h2 className="font-display font-semibold">Platform growth</h2>
            <InfoTip text="Inbound messages across every tenant, last 14 days." />
          </div>
          <SimpleAreaChart data={growthData} dataKey="messages" name="Messages in" />
        </Card>

        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold">Tenants</h2>
            <span className="text-xs text-faint">{tenants.length} total</span>
          </div>
          <TenantsTable data={tenantRows} pageSize={8} />
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-3 font-display font-semibold">Subscription plans</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p, i) => {
              const limits = (p.limits as Record<string, number>) ?? {};
              const accentTiles = ["from-accent to-accent-ink", "from-indigo to-[#4338ca]", "from-amber to-[#92400e]", "from-rose to-[#9f1239]"];
              return (
                <div key={p.id} className="group relative overflow-hidden rounded-2xl border border-line p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]">
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${accentTiles[i % accentTiles.length]}`} />
                  <div className="flex items-center justify-between">
                    <div className="font-display font-semibold">{p.name}</div>
                    {p.whiteLabel && <Badge tone="accent">white-label</Badge>}
                  </div>
                  <div className="mt-1 font-display text-lg font-bold">{p.priceMonthly === 0 ? "Free" : `$${(p.priceMonthly / 100).toLocaleString("en-US")}`}<span className="text-xs font-normal text-faint">{p.priceMonthly === 0 ? "" : "/mo"}</span></div>
                  <ul className="mt-2.5 space-y-1 text-xs text-muted">
                    <li>{limits.users ?? "∞"} users</li>
                    <li>{limits.messagesPerMonth ?? "∞"} messages/mo</li>
                    <li>{limits.connectors ?? "∞"} connectors</li>
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-faint">Plans are configurable (stored in the Plan model), not hard-coded into the app.</p>
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-1 font-display font-semibold">AI providers</h2>
          <p className="mb-3 text-xs text-muted">Every reply automatically tries the primary first, then fails over down this list if a provider is unreachable, rate-limited, or out of credit — nothing here needs manual switching. Counts reset daily (UTC).</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AI_PROVIDERS.map((p) => {
              const configured = !!process.env[p.keyEnv];
              const stat = aiStatsToday.find((s) => s.provider === p.id);
              const isPrimary = p.id === primaryProvider;
              let tone: "green" | "amber" | "rose" | "neutral" = "neutral";
              let statusLabel = "not configured";
              if (configured) {
                if (!stat || stat.calls === 0) { tone = "neutral"; statusLabel = "no calls yet today"; }
                else if (stat.successes > 0 && stat.failures === 0) { tone = "green"; statusLabel = "healthy"; }
                else if (stat.successes > 0 && stat.failures > 0) { tone = "amber"; statusLabel = "intermittent errors"; }
                else { tone = "rose"; statusLabel = stat.lastStatus === 429 ? "rate-limited" : stat.lastStatus === 402 ? "no credit" : "failing"; }
                if (stat?.rateLimitRemaining != null && stat.rateLimitLimit) {
                  const pct = stat.rateLimitRemaining / stat.rateLimitLimit;
                  if (pct < 0.15 && tone !== "rose") { tone = "amber"; statusLabel = "quota running low"; }
                }
              }
              const Icon = p.icon;
              const quotaPct = stat?.rateLimitRemaining != null && stat.rateLimitLimit ? Math.max(0, Math.min(100, (stat.rateLimitRemaining / stat.rateLimitLimit) * 100)) : null;
              return (
                <div key={p.id} className={`rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${isPrimary ? "border-accent/40 bg-accent-soft/40" : "border-line"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`grid h-8 w-8 place-items-center rounded-lg ${configured ? "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] text-white" : "bg-surface-2 text-faint"}`}>
                        <Icon size={15} />
                      </span>
                      <span className="font-medium">{p.label}</span>
                    </div>
                    {isPrimary && <Badge tone="accent">primary</Badge>}
                  </div>
                  <div className="mt-2.5"><Badge tone={tone} dot>{statusLabel}</Badge></div>
                  <div className="mt-2 text-xs text-muted">
                    {configured
                      ? `${stat?.calls ?? 0} call${stat?.calls === 1 ? "" : "s"} today · ${stat?.successes ?? 0} ok · ${stat?.failures ?? 0} failed`
                      : "No API key set in environment"}
                  </div>
                  {quotaPct != null && (
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                        <div className={`h-full rounded-full ${quotaPct < 15 ? "bg-rose" : quotaPct < 40 ? "bg-amber" : "bg-green"}`} style={{ width: `${quotaPct}%` }} />
                      </div>
                      <div className="mt-1 text-[11px] text-faint">{stat!.rateLimitRemaining}/{stat!.rateLimitLimit} quota left</div>
                    </div>
                  )}
                  {stat?.lastError && tone !== "green" && (
                    <div className="mt-1.5 truncate text-[11px] text-faint" title={stat.lastError}>Last error: {stat.lastError}</div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
