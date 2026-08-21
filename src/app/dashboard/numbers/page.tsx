import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { embeddedSignupConfigured } from "@/lib/whatsapp-embedded-signup";
import { ConnectWhatsAppButton } from "./connect-whatsapp-button";

export default async function NumbersPage({ searchParams }: { searchParams: Promise<{ embedded_signup?: string; message?: string }> }) {
  const user = await requireTenantUser();
  const { embedded_signup: signupResult, message } = await searchParams;
  const numbers = await db.whatsAppNumber.findMany({
    where: { tenantId: user.tenantId! },
    include: { _count: { select: { conversations: true } } },
    orderBy: { createdAt: "asc" },
  });
  const canConnect = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);

  return (
    <div>
      <PageHeader
        title="WhatsApp Numbers"
        subtitle="Your organization's own numbers. Each is a routing front door — messages to it reach only your systems. Connect a Cloud API number, then assign capabilities."
      />
      {signupResult === "success" && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
          WhatsApp connection started. Meta is finishing the link on their side — this can take a few minutes to fully appear below.
        </div>
      )}
      {signupResult === "error" && (
        <div className="mb-4 rounded-xl bg-rose-soft px-4 py-3 text-sm text-rose">
          Couldn&apos;t connect WhatsApp: {message || "something went wrong on Meta's side."}
        </div>
      )}
      {canConnect && (
        <div className="mb-4">
          {embeddedSignupConfigured() ? (
            <ConnectWhatsAppButton />
          ) : (
            <p className="text-xs text-faint">Real self-service WhatsApp connection isn&apos;t configured yet on this deployment.</p>
          )}
        </div>
      )}
      <div className="space-y-3">
        {numbers.length === 0 && <Card className="p-6 text-sm text-muted">No numbers connected yet.</Card>}
        {numbers.map((n) => (
          <Card key={n.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-semibold">{n.phoneNumber}</span>
                  <Badge tone={n.status === "active" ? "green" : "neutral"}>{n.status}</Badge>
                  <Badge tone={n.verificationStatus === "verified" ? "accent" : "amber"}>{n.verificationStatus}</Badge>
                </div>
                <div className="mt-1 text-sm">{n.displayName}{n.department ? ` · ${n.department}` : ""}</div>
                <div className="mt-1 font-mono text-[11px] text-faint">phone_number_id: {n.phoneNumberId ?? "—"}</div>
              </div>
              <div className="text-right text-xs text-muted">
                <div>{n._count.conversations} conversation(s)</div>
                <div className="mt-1 text-faint">Users message this number directly.</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-faint">
        Connecting a real number uses the official WhatsApp Business Cloud API: register the number, set the
        webhook to <code>/api/channels/whatsapp/webhook</code>, and P2Less routes inbound messages to this tenant by <code>phone_number_id</code>.
      </p>
    </div>
  );
}
