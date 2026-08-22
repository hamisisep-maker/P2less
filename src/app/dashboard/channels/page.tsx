import { requireTenantUser, userPermissions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Badge } from "@/components/ui";
import { PERMISSIONS } from "@/lib/permissions";
import { embeddedSignupConfigured } from "@/lib/whatsapp-embedded-signup";
import { messengerConnectConfigured } from "@/lib/messenger";
import { ConnectWhatsAppButton } from "./connect-whatsapp-button";
import { ConnectMessengerButton } from "./connect-messenger-button";
import { ConnectTelegramForm } from "./connect-telegram-form";
import { ConnectEmailButton } from "./connect-email-button";
import { emailInboundConfigured } from "@/lib/email-channel";

// Registration reframe, continued (roadmap doc "Registration reframe" —
// Track A) — the data model already treats WhatsApp numbers and a
// Messenger Page as the same underlying concept (Channel, or the
// WhatsApp-specific richer WhatsAppNumber row); this page is the small,
// bounded UI consolidation that follows from that, replacing the two
// separate /dashboard/numbers and /dashboard/messenger pages. Deliberately
// NOT the full Track B dynamic-navigation rework (developer/social/industry
// workspaces) — just "channels, shown together," since that's genuinely
// what the data underneath already is.
export default async function ChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{ embedded_signup?: string; connect?: string; message?: string }>;
}) {
  const user = await requireTenantUser();
  const { embedded_signup: waSignupResult, connect: messengerConnectResult, message } = await searchParams;
  const canConnect = userPermissions(user).includes(PERMISSIONS.TENANT_MANAGE);

  const [numbers, messengerChannel, telegramChannel, emailChannel] = await Promise.all([
    db.whatsAppNumber.findMany({
      where: { tenantId: user.tenantId! },
      include: { _count: { select: { conversations: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.channel.findFirst({ where: { tenantId: user.tenantId!, type: "messenger" } }),
    db.channel.findFirst({ where: { tenantId: user.tenantId!, type: "telegram" } }),
    db.channel.findFirst({ where: { tenantId: user.tenantId!, type: "email" } }),
  ]);
  const messengerPageName = (messengerChannel?.config as { pageName?: string } | null)?.pageName;
  const telegramUsername = (telegramChannel?.config as { botUsername?: string } | null)?.botUsername;

  return (
    <div>
      <PageHeader title="Channels" subtitle="Every way your customers can reach you — one platform, all channels." />

      <h2 className="mt-2 font-display text-lg font-semibold">WhatsApp</h2>
      {waSignupResult === "success" && (
        <div className="mb-4 mt-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
          WhatsApp connection started. Meta is finishing the link on their side — this can take a few minutes to fully appear below.
        </div>
      )}
      {waSignupResult === "error" && (
        <div className="mb-4 mt-2 rounded-xl bg-rose-soft px-4 py-3 text-sm text-rose">
          Couldn&apos;t connect WhatsApp: {message || "something went wrong on Meta's side."}
        </div>
      )}
      {canConnect && (
        <div className="mb-4 mt-2">
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
      <p className="mt-3 text-xs text-faint">
        Connecting a real number uses the official WhatsApp Business Cloud API: register the number, set the
        webhook to <code>/api/channels/whatsapp/webhook</code>, and P2Less routes inbound messages to this tenant by <code>phone_number_id</code>.
      </p>

      <h2 className="mt-8 font-display text-lg font-semibold">Facebook Messenger</h2>
      {messengerConnectResult === "success" && (
        <div className="mb-4 mt-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent-ink">
          Facebook Page connected. Messages sent to your Page will now reach P2Less.
        </div>
      )}
      {messengerConnectResult === "error" && (
        <div className="mb-4 mt-2 rounded-xl bg-rose-soft px-4 py-3 text-sm text-rose">
          Couldn&apos;t connect a Facebook Page: {message || "something went wrong on Meta's side."}
        </div>
      )}
      {messengerConnectResult === "partial" && (
        <div className="mb-4 mt-2 rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm text-amber">
          {message || "Page connected, but the webhook subscription needs another try."} Try connecting again — the
          Page itself is already saved.
        </div>
      )}
      {canConnect && (
        <div className="mb-4 mt-2">
          {messengerConnectConfigured() ? (
            <ConnectMessengerButton />
          ) : (
            <p className="text-xs text-faint">Facebook Page connection isn&apos;t configured yet on this deployment.</p>
          )}
        </div>
      )}
      {messengerChannel ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{messengerPageName ?? "Connected Page"}</span>
                <Badge tone={messengerChannel.status === "active" ? "green" : "neutral"}>{messengerChannel.status}</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-faint">page_id: {messengerChannel.address}</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted">No Facebook Page connected yet.</Card>
      )}
      <p className="mt-3 text-xs text-faint">
        Text messages sent to your Page are answered the same way as WhatsApp — grounded in your own FAQs and
        connected systems, never invented. Media/postback-button handling isn&apos;t built yet (text only for now).
      </p>

      <h2 className="mt-8 font-display text-lg font-semibold">Telegram</h2>
      {canConnect && (
        <div className="mb-4 mt-2">
          <ConnectTelegramForm />
          <p className="mt-2 text-xs text-faint">
            Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-accent underline">@BotFather</a> on
            Telegram (free, instant, no approval needed), then paste the token it gives you above.
          </p>
        </div>
      )}
      {telegramChannel ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{telegramUsername ? `@${telegramUsername}` : "Connected bot"}</span>
                <Badge tone={telegramChannel.status === "active" ? "green" : "amber"}>{telegramChannel.status === "active" ? "active" : "needs reconnecting"}</Badge>
              </div>
              <div className="mt-1 font-mono text-[11px] text-faint">bot_id: {telegramChannel.address}</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted">No Telegram bot connected yet.</Card>
      )}
      <p className="mt-3 text-xs text-faint">
        Anyone who messages your bot on Telegram gets the same grounded answers as WhatsApp — no App Review, no
        Business Verification, no 24-hour reply window. Text only for now (no photos/files/inline buttons yet).
      </p>

      <h2 className="mt-8 font-display text-lg font-semibold">Email</h2>
      {canConnect && (
        <div className="mb-4 mt-2">
          {emailInboundConfigured() ? (
            <ConnectEmailButton />
          ) : (
            <p className="text-xs text-faint">Email isn&apos;t configured on this deployment yet.</p>
          )}
        </div>
      )}
      {emailChannel ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-semibold">{emailChannel.address}</span>
                <Badge tone={emailChannel.status === "active" ? "green" : "neutral"}>{emailChannel.status}</Badge>
              </div>
              <div className="mt-1 text-xs text-faint">Share this address with customers who&apos;d rather email than chat.</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-6 text-sm text-muted">No email address activated yet.</Card>
      )}
      <p className="mt-3 text-xs text-faint">
        Slowest channel of the five, and the only one where a reply isn&apos;t instant — emails get the same
        grounded answers, replied to as a normal email. Quoted-reply-chain stripping is a best-effort heuristic,
        not perfect for every email client. Text only, no attachments yet.
      </p>
    </div>
  );
}
