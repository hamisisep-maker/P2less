import { requireSuperAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions";
import { db } from "@/lib/db";
import { Card, Stat, PageHeader, Badge, Logo } from "@/components/ui";

// Ordered the same way the AI failover chain tries them (see providerChain()
// in ai.ts) — google first, since that's the intended default primary.
const AI_PROVIDERS = [
  { id: "google", label: "Gemini (Google)", keyEnv: "GEMINI_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "anthropic", label: "Claude (Anthropic)", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "xai", label: "Grok (xAI)", keyEnv: "XAI_API_KEY" },
] as const;

export default async function AdminPage() {
  await requireSuperAdmin();
  const today = new Date().toISOString().slice(0, 10);
  const [tenants, plans, totalConvos, totalMsgs, aiStatsToday] = await Promise.all([
    db.tenant.findMany({ include: { subscription: { include: { plan: true } }, _count: { select: { users: true, connectors: true, contacts: true } } }, orderBy: { createdAt: "asc" } }),
    db.plan.findMany({ orderBy: { sort: "asc" } }),
    db.conversation.count(),
    db.usageEvent.aggregate({ where: { type: "message_in" }, _sum: { quantity: true } }),
    db.aiProviderStat.findMany({ where: { date: today } }),
  ]);
  const configuredPrimary = (process.env.AI_PROVIDER || "").toLowerCase();
  const primaryProvider = AI_PROVIDERS.find((p) => p.id === configuredPrimary && !!process.env[p.keyEnv])?.id
    ?? AI_PROVIDERS.find((p) => !!process.env[p.keyEnv])?.id;

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-10">
      <div className="mb-6 flex items-center justify-between">
        <Logo />
        <form action={logoutAction}><button className="text-sm text-rose hover:underline">Sign out</button></form>
      </div>
      <PageHeader title="Platform administration" subtitle="P2Less Super Admin — tenants, plans, and platform-wide usage." />

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Tenants" value={tenants.length} />
        <Stat label="Plans" value={plans.length} />
        <Stat label="Conversations" value={totalConvos} />
        <Stat label="Inbound messages" value={totalMsgs._sum.quantity ?? 0} />
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Tenants</h2>
        <div className="space-y-2">
          {tenants.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div>
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted">{t.industry} · {t._count.users} staff · {t._count.connectors} connectors · {t._count.contacts} contacts</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="accent">{t.subscription?.plan.name ?? "no plan"}</Badge>
                <Badge tone={t.status === "active" ? "green" : "amber"}>{t.status}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-4 p-5">
        <h2 className="mb-3 font-semibold">Subscription plans</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const limits = (p.limits as Record<string, number>) ?? {};
            return (
              <div key={p.id} className="rounded-xl border border-line p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{p.name}</div>
                  {p.whiteLabel && <Badge tone="accent">white-label</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted">{p.priceMonthly === 0 ? "Free" : `${p.priceMonthly} / mo`}</div>
                <ul className="mt-2 space-y-0.5 text-xs text-muted">
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
        <h2 className="mb-1 font-semibold">AI providers</h2>
        <p className="mb-3 text-xs text-muted">Every reply automatically tries the primary first, then fails over down this list if a provider is unreachable, rate-limited, or out of credit — nothing here needs manual switching. Counts reset daily (UTC).</p>
        <div className="space-y-2">
          {AI_PROVIDERS.map((p) => {
            const configured = !!process.env[p.keyEnv];
            const stat = aiStatsToday.find((s) => s.provider === p.id);
            const isPrimary = p.id === primaryProvider;
            let tone: "green" | "amber" | "rose" | "neutral" = "neutral";
            let statusLabel = "not configured";
            if (configured) {
              if (!stat || stat.calls === 0) { tone = "neutral"; statusLabel = "configured — no calls yet today"; }
              else if (stat.successes > 0 && stat.failures === 0) { tone = "green"; statusLabel = "healthy"; }
              else if (stat.successes > 0 && stat.failures > 0) { tone = "amber"; statusLabel = "intermittent errors"; }
              else { tone = "rose"; statusLabel = stat.lastStatus === 429 ? "rate-limited" : stat.lastStatus === 402 ? "no credit / payment required" : "failing"; }
              if (stat?.rateLimitRemaining != null && stat.rateLimitLimit) {
                const pct = stat.rateLimitRemaining / stat.rateLimitLimit;
                if (pct < 0.15 && tone !== "rose") { tone = "amber"; statusLabel = "quota running low"; }
              }
            }
            return (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {p.label}
                    {isPrimary && <Badge tone="accent">primary</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {configured
                      ? `${stat?.calls ?? 0} call${stat?.calls === 1 ? "" : "s"} today · ${stat?.successes ?? 0} ok · ${stat?.failures ?? 0} failed${stat?.rateLimitRemaining != null ? ` · ${stat.rateLimitRemaining}${stat.rateLimitLimit ? `/${stat.rateLimitLimit}` : ""} quota left` : ""}`
                      : "No API key set in environment"}
                  </div>
                  {stat?.lastError && tone !== "green" && (
                    <div className="mt-0.5 truncate text-xs text-faint" title={stat.lastError}>Last error: {stat.lastError}</div>
                  )}
                </div>
                <Badge tone={tone}>{statusLabel}</Badge>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
