import { withTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS } from "@/lib/permissions";
import { Card, PageHeader, Badge } from "@/components/ui";
import { WidgetKeyForm } from "./widget-key-form";
import { WidgetKeyRow } from "./widget-key-row";

// Two letters so a visitor sees THIS org's mark, not a generic P2Less icon —
// logoText lets an admin override it (e.g. a real short code), but most
// orgs will never touch it, so a sensible default from the org's own name
// matters more than the override itself.
function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "P2";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// The snippet is copy-pasted verbatim into someone else's raw HTML — an
// unescaped quote in an org's name would silently break their page.
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default async function WidgetPage() {
  return withTenantUser(async (user) => {
    const canManage = userPermissions(user).includes(PERMISSIONS.DEVELOPER_MANAGE);
    const [keys, tenant] = await Promise.all([
      db.widgetKey.findMany({ where: { tenantId: user.tenantId! }, orderBy: { createdAt: "desc" } }),
      db.tenant.findUnique({ where: { id: user.tenantId! }, select: { name: true, branding: true } }),
    ]);
    const base = (process.env.PUBLIC_BASE_URL || "https://your-p2less-host").replace(/\/$/, "");
    const branding = (tenant?.branding as { assistantName?: string; logoText?: string; primaryColor?: string } | null) ?? null;
    const displayName = branding?.assistantName || tenant?.name || "us";
    const initials = branding?.logoText || deriveInitials(tenant?.name || "P2Less");
    const color = branding?.primaryColor || "";

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
          <p className="mb-3 text-xs text-muted">The bubble shows <strong>{initials}</strong> and your own color below — every organization&apos;s widget looks like their own, not a generic P2Less icon. Set a custom two-letter mark or color under Branding if you don&apos;t want the auto-generated one.</p>
          <div className="overflow-x-auto rounded-xl bg-ink p-4">
            <pre className="text-xs leading-relaxed text-white/90"><code>{`<script src="${base}/widget.js" async data-key="${keys[0]?.key ?? "wk_your_widget_key"}" data-name="${escapeAttr(displayName)}" data-initials="${escapeAttr(initials)}"${color ? ` data-color="${escapeAttr(color)}"` : ""}></script>`}</code></pre>
          </div>
        </Card>
      </div>
    );
  });
}
