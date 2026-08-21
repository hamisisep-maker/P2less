import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { messengerConnectConfigured } from "@/lib/messenger";
import { ConnectMessengerButton } from "./connect-messenger-button";

export default async function MessengerPage({ searchParams }: { searchParams: Promise<{ connect?: string; message?: string }> }) {
  const user = await requireTenantUser();
  const { connect: connectResult, message } = await searchParams;
  const channel = await db.channel.findFirst({ where: { tenantId: user.tenantId!, type: "messenger" } });
  const canConnect = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);
  const pageName = (channel?.config as { pageName?: string } | null)?.pageName;

  return (
    <div>
      <PageHeader
        title="Messenger"
        subtitle="Reply to messages sent to your organization's Facebook Page — same grounded, connector-backed answers as WhatsApp, just a different delivery channel."
      />
      {connectResult === "success" && (
        <div className="mb-4 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
          Facebook Page connected. Messages sent to your Page will now reach P2Less.
        </div>
      )}
      {connectResult === "error" && (
        <div className="mb-4 rounded-xl bg-rose-soft px-4 py-3 text-sm text-rose">
          Couldn&apos;t connect a Facebook Page: {message || "something went wrong on Meta's side."}
        </div>
      )}
      {connectResult === "partial" && (
        <div className="mb-4 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
          {message || "Page connected, but the webhook subscription needs another try."} Try connecting again — the
          Page itself is already saved.
        </div>
      )}
      {canConnect && (
        <div className="mb-4">
          {messengerConnectConfigured() ? (
            <ConnectMessengerButton />
          ) : (
            <p className="text-xs text-faint">Facebook Page connection isn&apos;t configured yet on this deployment.</p>
          )}
        </div>
      )}
      {channel ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{pageName ?? "Connected Page"}</span>
                <Badge tone={channel.status === "active" ? "green" : "neutral"}>{channel.status}</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-faint">page_id: {channel.address}</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted">No Facebook Page connected yet.</Card>
      )}
      <p className="mt-4 text-xs text-faint">
        Text messages sent to your Page are answered the same way as WhatsApp — grounded in your own FAQs and
        connected systems, never invented. Media/postback-button handling isn&apos;t built yet (text only for now).
      </p>
    </div>
  );
}
