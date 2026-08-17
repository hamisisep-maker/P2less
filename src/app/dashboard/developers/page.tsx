import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { revokeApiKeyAction, deleteWebhookAction } from "@/lib/actions";
import { Card, PageHeader, Badge } from "@/components/ui";
import { ApiKeyForm } from "./api-key-form";
import { WebhookForm } from "./webhook-form";

export default async function DevelopersPage() {
  const user = await requireTenantUser();
  const canManage = userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE);
  const [keys, hooks] = await Promise.all([
    db.apiKey.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } }),
    db.webhook.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } }),
  ]);
  const base = (process.env.PUBLIC_BASE_URL || "https://your-p2less-host").replace(/\/$/, "");

  return (
    <div>
      <PageHeader title="Developers" subtitle="Build on P2Less: a REST API scoped to your organization, and webhooks for real-time events." />

      {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view developer settings, but need the <code>developer.manage</code> permission to create keys or webhooks.</Card>}

      {/* API keys */}
      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-semibold">API keys</h2>
        <p className="mb-3 text-sm text-muted">Authenticate requests with <code>Authorization: Bearer p2l_…</code>. Keys are read-scoped and tied to this organization.</p>
        {canManage && <ApiKeyForm />}
        <div className="mt-4 space-y-2">
          {keys.length === 0 && <p className="text-sm text-muted">No keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div>
                <div className="text-sm font-medium">{k.name}</div>
                <div className="font-mono text-xs text-faint">{k.prefix}… · created {k.createdAt.toLocaleDateString()}{k.lastUsedAt ? ` · last used ${k.lastUsedAt.toLocaleDateString()}` : ""}</div>
              </div>
              <div className="flex items-center gap-2">
                {k.revokedAt ? <Badge tone="rose">revoked</Badge> : <Badge tone="green">active</Badge>}
                {canManage && !k.revokedAt && (
                  <form action={revokeApiKeyAction}>
                    <input type="hidden" name="id" value={k.id} />
                    <button className="text-xs text-rose hover:underline">Revoke</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Webhooks */}
      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-semibold">Webhooks</h2>
        <p className="mb-3 text-sm text-muted">We POST signed JSON to your endpoint on each subscribed event. Verify the <code>X-P2Less-Signature</code> (HMAC-SHA256 of the body with your secret).</p>
        {canManage && <WebhookForm />}
        <div className="mt-4 space-y-2">
          {hooks.length === 0 && <p className="text-sm text-muted">No endpoints yet.</p>}
          {hooks.map((h) => (
            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3.5 py-2.5">
              <div className="min-w-0">
                <div className="truncate font-mono text-sm">{h.url}</div>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {((h.events as string[]) ?? []).map((e) => <span key={e} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">{e}</span>)}
                </div>
              </div>
              {canManage && (
                <form action={deleteWebhookAction}>
                  <input type="hidden" name="id" value={h.id} />
                  <button className="text-xs text-rose hover:underline">Delete</button>
                </form>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Docs */}
      <Card className="p-5">
        <h2 className="mb-3 font-semibold">Quick start</h2>
        <div className="overflow-x-auto rounded-xl bg-ink p-4">
          <pre className="text-xs leading-relaxed text-white/90"><code>{`# List conversations
curl ${base}/api/v1/conversations \\
  -H "Authorization: Bearer p2l_your_key"

# Registered numbers · capabilities · usage
curl ${base}/api/v1/numbers        -H "Authorization: Bearer p2l_your_key"
curl ${base}/api/v1/capabilities   -H "Authorization: Bearer p2l_your_key"
curl ${base}/api/v1/usage          -H "Authorization: Bearer p2l_your_key"

# Verify a webhook (Node)
const sig = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET)
  .update(rawBody).digest("hex");
if (sig === req.headers["x-p2less-signature"]) { /* trusted */ }`}</code></pre>
        </div>
      </Card>
    </div>
  );
}
