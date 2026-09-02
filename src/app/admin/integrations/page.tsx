import { db } from "@/lib/db";
import { withAdminPermission } from "@/lib/admin-authz";
import { Card, PageHeader } from "@/components/ui";
import { IntegrationRow } from "./integration-row";
import { DependencyMap } from "./dependency-map";
import { TrainingCredentialRow } from "./training-credential-row";

const CATEGORY_LABELS: Record<string, string> = {
  messaging: "Messaging",
  payments: "Payments",
  ai: "AI providers",
  notification: "Notifications",
  infrastructure: "Infrastructure",
};
const CATEGORY_ORDER = ["messaging", "payments", "ai", "notification", "infrastructure"];

// Credential presence derived from the real env vars each integration
// actually reads at runtime today (see mpesa.ts / ai.ts / transport.ts) —
// masked "configured/not configured" only, never the value itself. Full
// replace/rotate via the encrypted IntegrationCredential vault is real
// infrastructure (see prisma schema) but not yet wired as the RUNTIME
// source for these — env vars remain authoritative until that migration,
// stated here honestly rather than implying an edit here changes live behavior.
function credentialStatus(key: string): "configured" | "not_configured" | "n/a" {
  const envKey: Record<string, string | string[]> = {
    whatsapp_cloud_api: "WHATSAPP_ACCESS_TOKEN",
    mpesa_stk: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET"],
    mpesa_paybill: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET"],
    mpesa_till: ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET"],
    ai_google: "GEMINI_API_KEY", ai_groq: "GROQ_API_KEY", ai_cerebras: "CEREBRAS_API_KEY",
    ai_openrouter: "OPENROUTER_API_KEY", ai_anthropic: "ANTHROPIC_API_KEY", ai_openai: "OPENAI_API_KEY", ai_xai: "XAI_API_KEY",
  };
  const spec = envKey[key];
  if (!spec) return "n/a";
  const keys = Array.isArray(spec) ? spec : [spec];
  return keys.every((k) => !!process.env[k]) ? "configured" : "not_configured";
}

export default async function AdminIntegrationsPage() {
  return withAdminPermission("integrations.view", async () => {
    const integrations = await db.integration.findMany({ orderBy: { name: "asc" } });
    const trainingCredentials = await db.trainingIntegrationCredential.findMany({ orderBy: { createdAt: "desc" } });

    const byCategory = new Map<string, typeof integrations>();
    for (const i of integrations) {
      if (!byCategory.has(i.category)) byCategory.set(i.category, []);
      byCategory.get(i.category)!.push(i);
    }

    return (
      <div>
        <PageHeader
          title="Integrations"
          subtitle="Every external dependency the platform relies on — real status, not a page that just renders."
        />

        <Card className="p-5">
          <h2 className="mb-1 font-display font-semibold">Dependency map</h2>
          <p className="mb-3 text-xs text-muted">If M-Pesa fails, this is exactly what's affected — and what isn't.</p>
          <DependencyMap
            mpesaOk={integrations.find((i) => i.key === "mpesa_stk")?.lastCheckOk ?? null}
            whatsappOk={integrations.find((i) => i.key === "whatsapp_cloud_api")?.lastCheckOk ?? null}
            aiOk={integrations.some((i) => i.key.startsWith("ai_") && i.lastCheckOk === true)}
            dbOk={integrations.find((i) => i.key === "database")?.lastCheckOk ?? null}
          />
        </Card>

        <Card className="mt-4 p-5">
          <h2 className="mb-1 font-display font-semibold">Training platform access</h2>
          <p className="mb-3 text-xs text-muted">
            Who can call <code>/api/training/evaluate</code> and{" "}
            <code>/api/training/findings</code> — the Hamzone AI Training &amp;
            Evaluation platform&apos;s integration
            (docs/integrations/HAMZONE-AI-TRAINING-2026-09-02.md). Disabling a
            credential here blocks every request using it immediately, no
            redeploy or secret rotation needed — the emergency stop for a
            credential compromise, unexpected AI cost, or a malfunctioning
            campaign on that platform&apos;s side.
          </p>
          <div className="space-y-2">
            {trainingCredentials.length === 0 && <p className="text-sm text-muted">No training-platform credentials issued yet.</p>}
            {trainingCredentials.map((c) => (
              <TrainingCredentialRow
                key={c.id}
                data={{
                  id: c.id,
                  name: c.name,
                  scopes: c.scopes as string[],
                  revokedAt: c.revokedAt?.toISOString() ?? null,
                  lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
                  createdAt: c.createdAt.toISOString(),
                }}
              />
            ))}
          </div>
        </Card>

        <div className="mt-4 space-y-4">
          {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
            <Card key={category} className="p-5">
              <h2 className="mb-3 font-display font-semibold">{CATEGORY_LABELS[category] ?? category}</h2>
              <div className="space-y-2">
                {byCategory.get(category)!.map((i) => (
                  <IntegrationRow
                    key={i.key}
                    data={{
                      key: i.key, name: i.name, provider: i.provider, environment: i.environment, enabled: i.enabled,
                      lastCheckedAt: i.lastCheckedAt, lastCheckOk: i.lastCheckOk, lastCheckDetail: i.lastCheckDetail,
                      docsUrl: i.docsUrl, providerDashboardUrl: i.providerDashboardUrl, billingUrl: i.billingUrl,
                      credentialStatus: credentialStatus(i.key),
                    }}
                  />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  });
}
