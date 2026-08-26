import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { InfoTip } from "@/components/dashboard-ui";
import { getAiProviderCosts, AI_PROVIDER_TOPUP_URL, getSetting } from "@/lib/platform-settings";
import { withAdminPermission } from "@/lib/admin-authz";
import { getKeyHealth, type Provider } from "@/lib/ai";
import { ProviderCard, type ProviderCardData } from "./provider-card";
import { ResetPrimaryButton } from "./reset-primary-button";

const AI_PROVIDERS: { id: Provider; label: string; keyEnv: string }[] = [
  { id: "google", label: "Gemini", keyEnv: "GEMINI_API_KEY" },
  { id: "groq", label: "Groq", keyEnv: "GROQ_API_KEY" },
  { id: "cerebras", label: "Cerebras", keyEnv: "CEREBRAS_API_KEY" },
  { id: "openrouter", label: "OpenRouter", keyEnv: "OPENROUTER_API_KEY" },
  { id: "anthropic", label: "Claude", keyEnv: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", keyEnv: "OPENAI_API_KEY" },
  { id: "xai", label: "Grok", keyEnv: "XAI_API_KEY" },
];

export default async function AdminAiPage() {
  return withAdminPermission("providers.view", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [aiStatsToday, aiStatsMonth, aiCosts, dbPrimary, realCostByProvider, dbKeyRows] = await Promise.all([
      db.aiProviderStat.findMany({ where: { date: today } }),
      db.aiProviderStat.findMany({ where: { date: { startsWith: monthPrefix } } }),
      getAiProviderCosts(),
      getSetting("ai_primary_provider"),
      // Prefer this over calls×cost-per-call whenever real token-cost data
      // exists for a provider this month — was previously always the flat
      // estimate here even when /admin/models had the real figure, so the two
      // pages could show different numbers for the same provider.
      db.aiRequestLog.groupBy({ by: ["provider"], where: { createdAt: { gte: monthStart } }, _sum: { costKes: true }, _count: { _all: true } }),
      // Real, admin-added keys, 2026-08-26 — numbered "Key 1"/"Key 2"/... by
      // creation order (never a stored ordinal), each with its own tracked
      // usage below.
      db.integrationCredential.findMany({
        where: { active: true, label: "api_key", integration: { key: { startsWith: "ai_" } } },
        select: { id: true, maskedPreview: true, startingBalanceUsd: true, createdAt: true, integration: { select: { key: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const realCostMap = new Map(realCostByProvider.map((r) => [r.provider, { costKes: r._sum.costKes ?? 0, count: r._count._all }]));

    const keyIds = dbKeyRows.map((r) => r.id);
    const usageByKey = keyIds.length > 0
      ? await db.aiRequestLog.groupBy({ by: ["credentialId"], where: { credentialId: { in: keyIds } }, _sum: { totalTokens: true, costUsd: true } })
      : [];
    const usageMap = new Map(usageByKey.map((u) => [u.credentialId, { tokens: u._sum.totalTokens ?? 0, costUsd: u._sum.costUsd ?? 0 }]));
    const dbKeysByProvider = new Map<string, ProviderCardData["dbKeys"]>();
    for (const row of dbKeyRows) {
      const provider = row.integration.key.replace("ai_", "");
      const list = dbKeysByProvider.get(provider) ?? [];
      const usage = usageMap.get(row.id);
      const costUsd = usage?.costUsd ?? 0;
      list.push({
        id: row.id,
        number: list.length + 1,
        maskedPreview: row.maskedPreview,
        tokensUsed: usage?.tokens ?? 0,
        startingBalanceUsd: row.startingBalanceUsd,
        remainingUsd: row.startingBalanceUsd != null ? Math.max(0, row.startingBalanceUsd - costUsd) : null,
      });
      dbKeysByProvider.set(provider, list);
    }

    // getKeyHealth() reads the SAME in-memory pool callLLM()'s rotation uses —
    // "configured" now means "has at least one key" (singular env var OR the
    // multi-key _API_KEYS pool), not just the original singular var, so a
    // provider running purely on GEMINI_API_KEYS (no singular fallback set)
    // still shows correctly here instead of reading as "not configured".
    const keysByProvider = new Map(AI_PROVIDERS.map((p) => [p.id, getKeyHealth(p.id)]));
    const configuredPrimary = (dbPrimary || process.env.AI_PROVIDER || "").toLowerCase();
    const primaryProvider = AI_PROVIDERS.find((p) => p.id === configuredPrimary && (keysByProvider.get(p.id)?.length ?? 0) > 0)?.id
      ?? AI_PROVIDERS.find((p) => (keysByProvider.get(p.id)?.length ?? 0) > 0)?.id;

    const monthCallsByProvider = new Map<string, number>();
    for (const s of aiStatsMonth) monthCallsByProvider.set(s.provider, (monthCallsByProvider.get(s.provider) ?? 0) + s.successes);

    const cards: ProviderCardData[] = AI_PROVIDERS.map((p) => {
      const keys = keysByProvider.get(p.id) ?? [];
      const configured = keys.length > 0;
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
      const real = realCostMap.get(p.id);
      const spendIsReal = !!real && real.count > 0;
      const estimatedSpendMonthKes = spendIsReal ? Math.round(real!.costKes) : Math.round(monthCalls * costPerCallKes);
      return {
        id: p.id, label: p.label, configured, isPrimary: p.id === primaryProvider,
        tone, statusLabel, keys,
        calls: stat?.calls ?? 0, successes: stat?.successes ?? 0, failures: stat?.failures ?? 0, lastError: stat?.lastError ?? null,
        quotaRemaining: stat?.rateLimitRemaining ?? null, quotaLimit: stat?.rateLimitLimit ?? null,
        costPerCallKes, estimatedSpendMonthKes, spendIsReal,
        topUpUrl: AI_PROVIDER_TOPUP_URL[p.id] ?? "#",
        dbKeys: dbKeysByProvider.get(p.id) ?? [],
      };
    });

    const totalMonthSpend = cards.reduce((s, c) => s + c.estimatedSpendMonthKes, 0);

    return (
      <div>
        <PageHeader title="AI Providers" subtitle="Live usage, quota, cost tracking, and which model is primary — no redeploy needed to change any of it." />

        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
              AI spend this month
              <InfoTip text="Real per-token cost (see Models) where available this month; falls back to successful call counts × the cost/call you set below for any provider with no token data yet — each card says which it's showing." />
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
  });
}
