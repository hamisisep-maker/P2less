import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { InfoTip } from "@/components/dashboard-ui";
import { getAiProviderCosts, AI_PROVIDER_TOPUP_URL, getSetting } from "@/lib/platform-settings";
import { requireAdminPermission } from "@/lib/admin-authz";
import { ProviderCard, type ProviderCardData } from "./provider-card";
import { ResetPrimaryButton } from "./reset-primary-button";

const AI_PROVIDERS: { id: string; label: string; keyEnv: string }[] = [
  { id: "google", label: "Gemini", keyEnv: "GEMINI_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "anthropic", label: "Claude", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "xai", label: "Grok", keyEnv: "XAI_API_KEY" },
];

export default async function AdminAiPage() {
  await requireAdminPermission("providers.view");
  const today = new Date().toISOString().slice(0, 10);
  const monthPrefix = today.slice(0, 7);

  const [aiStatsToday, aiStatsMonth, aiCosts, dbPrimary] = await Promise.all([
    db.aiProviderStat.findMany({ where: { date: today } }),
    db.aiProviderStat.findMany({ where: { date: { startsWith: monthPrefix } } }),
    getAiProviderCosts(),
    getSetting("ai_primary_provider"),
  ]);

  const configuredPrimary = (dbPrimary || process.env.AI_PROVIDER || "").toLowerCase();
  const primaryProvider = AI_PROVIDERS.find((p) => p.id === configuredPrimary && !!process.env[p.keyEnv])?.id
    ?? AI_PROVIDERS.find((p) => !!process.env[p.keyEnv])?.id;

  const monthCallsByProvider = new Map<string, number>();
  for (const s of aiStatsMonth) monthCallsByProvider.set(s.provider, (monthCallsByProvider.get(s.provider) ?? 0) + s.successes);

  const cards: ProviderCardData[] = AI_PROVIDERS.map((p) => {
    const configured = !!process.env[p.keyEnv];
    const stat = aiStatsToday.find((s) => s.provider === p.id);
    let tone: "green" | "amber" | "rose" | "neutral" = "neutral";
    let statusLabel = "not configured";
    if (configured) {
      if (!stat || stat.calls === 0) { tone = "neutral"; statusLabel = "no calls yet today"; }
      else if (stat.successes > 0 && stat.failures === 0) { tone = "green"; statusLabel = "healthy"; }
      else if (stat.successes > 0 && stat.failures > 0) { tone = "amber"; statusLabel = "intermittent errors"; }
      else { tone = "rose"; statusLabel = stat.lastStatus === 429 ? "rate-limited" : stat.lastStatus === 402 ? "no credit" : "failing"; }
      const qp = stat?.rateLimitRemaining, ql = stat?.rateLimitLimit;
      if (qp != null && ql && qp / ql < 0.15 && tone !== "rose") { tone = "amber"; statusLabel = "quota running low"; }
    }
    const costPerCallKes = aiCosts[p.id] ?? 0;
    const monthCalls = monthCallsByProvider.get(p.id) ?? 0;
    return {
      id: p.id, label: p.label, configured, isPrimary: p.id === primaryProvider,
      tone, statusLabel,
      calls: stat?.calls ?? 0, successes: stat?.successes ?? 0, failures: stat?.failures ?? 0, lastError: stat?.lastError ?? null,
      quotaRemaining: stat?.rateLimitRemaining ?? null, quotaLimit: stat?.rateLimitLimit ?? null,
      costPerCallKes, estimatedSpendMonthKes: Math.round(monthCalls * costPerCallKes),
      topUpUrl: AI_PROVIDER_TOPUP_URL[p.id] ?? "#",
    };
  });

  const totalMonthSpend = cards.reduce((s, c) => s + c.estimatedSpendMonthKes, 0);

  return (
    <div>
      <PageHeader title="AI Providers" subtitle="Live usage, quota, cost tracking, and which model is primary — no redeploy needed to change any of it." />

      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
            Estimated AI spend this month
            <InfoTip text="Real successful call counts this month × the cost/call you set on each provider below." />
          </div>
          <div className="mt-1 font-display text-2xl font-bold">KES {totalMonthSpend.toLocaleString("en-US")}</div>
        </div>
        {dbPrimary && <ResetPrimaryButton />}
      </Card>

      <p className="mb-3 text-xs text-muted">Every reply automatically tries the primary first, then fails over down this list if a provider is unreachable, rate-limited, or out of credit — nothing here needs manual switching to keep working. Set a provider as primary below to change which one is tried first, effective immediately.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => <ProviderCard key={c.id} data={c} />)}
      </div>
    </div>
  );
}
