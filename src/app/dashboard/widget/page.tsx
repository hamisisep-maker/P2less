import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader, Badge } from "@/components/ui";
import { WidgetKeyForm } from "./widget-key-form";
import { WidgetKeyRow } from "./widget-key-row";

export default async function WidgetPage() {
  const user = await requireTenantUser();
  const canManage = userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE);
  const keys = await db.widgetKey.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } });
  const base = (process.env.PUBLIC_BASE_URL || "https://your-p2less-host").replace(/\/$/, "");

  return (
    <div>
      <PageHeader title="Website Widget" subtitle="Add a chat bubble to your own website that talks to the same assistant as WhatsApp — same knowledge, same connected systems, same rules." />

      {!canManage && <Card className="mb-4 p-4 text-sm text-muted">You can view widget keys, but need the <code>developer.manage</code> permission to create or change them.</Card>}

      <Card className="mb-4 p-5">
        <h2 className="mb-1 font-semibold">Widget keys</h2>
        <p className="mb-3 text-sm text-muted">
          A widget key is <strong>public</strong> — it gets pasted directly into your website&apos;s HTML, so it&apos;s safe for anyone to see. It only ever identifies which
          organization a visitor is chatting with; it can never be used to access your dashboard or data the way an API key can.
        </p>
        {canManage && <WidgetKeyForm />}
        <div className="mt-4 space-y-3">
          {keys.length === 0 && <p className="text-sm text-muted">No widget keys yet.</p>}
          {keys.map((k) => (
            <div key={k.id} className="rounded-xl border border-line px-3.5 py-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <code className="font-mono text-sm">{k.key}</code>
                <div className="flex items-center gap-2">
                  {k.active ? <Badge tone="green">active</Badge> : <Badge tone="rose">deactivated</Badge>}
                  <span className="text-xs text-faint">created {k.createdAt.toLocaleDateString()}{k.lastUsedAt ? ` · last used ${k.lastUsedAt.toLocaleDateString()}` : ""}</span>
                </div>
              </div>
              {k.active && <WidgetKeyRow id={k.id} canManage={canManage} origins={(k.allowedOrigins as string[] | null) ?? []} />}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-display font-semibold">Add it to your website</h2>
        <p className="mb-3 text-sm text-muted">Paste this before the closing <code>&lt;/body&gt;</code> tag of your site — or into your site builder&apos;s &quot;custom code&quot; / &quot;code injection&quot; field if you don&apos;t edit source files directly (WordPress, Squarespace, Wix, and Shopify all have one).</p>
        <div className="overflow-x-auto rounded-xl bg-ink p-4">
          <pre className="text-xs leading-relaxed text-white/90"><code>{`<script src="${base}/widget.js" data-key="${keys[0]?.key ?? "wk_your_widget_key"}"></script>`}</code></pre>
        </div>
      </Card>
    </div>
  );
}
