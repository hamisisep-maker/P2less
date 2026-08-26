// Phase 3, 2026-08-26 — one shared vocabulary for "where does this channel's
// connection actually stand," covering both Channel.connectionStatus (Messenger/
// Telegram/Email) and WhatsAppNumber.verificationStatus (WhatsApp, which has
// its own field since it's a richer, separate model). Pure functions only —
// same "classify now, caller resolves async facts first" discipline as
// resolveVisibleNav() in nav.ts; no DB access here.
export type ConnectionStatus = "not_started" | "connecting" | "connected" | "needs_attention" | "failed";

// Real bug found and fixed 2026-08-26 (direct report: badges were "confusing,
// hard to tell if connected"): this used to collapse verificationStatus
// "pending" AND "failed" into the same green "connected" badge a genuinely
// working number gets — only "connecting" got its own state. A number whose
// pairing had actually failed, or that had logged out and gone back to
// "pending", looked identical to one working normally.
export function whatsappConnectionStatus(n: { verificationStatus: string } | null | undefined): ConnectionStatus {
  if (!n) return "not_started";
  switch (n.verificationStatus) {
    case "verified": return "connected";
    case "connecting": return "connecting";
    case "failed": return "failed";
    case "pending": return "needs_attention";
    default: return "needs_attention";
  }
}

export type ChannelGapInput = {
  channelsNeeded: string[];
  whatsapp: ConnectionStatus;
  messenger: ConnectionStatus;
  telegram: ConnectionStatus;
  email: ConnectionStatus;
  hasWidgetKey: boolean;
};

export type ChannelGap = { key: string; label: string; href: string };

const GAP_DEFS: { key: string; label: string; href: string; connected: (i: ChannelGapInput) => boolean }[] = [
  { key: "whatsapp", label: "WhatsApp", href: "/dashboard/channels", connected: (i) => i.whatsapp !== "not_started" },
  { key: "messenger", label: "Facebook Messenger", href: "/dashboard/channels", connected: (i) => i.messenger !== "not_started" },
  { key: "telegram", label: "Telegram", href: "/dashboard/channels", connected: (i) => i.telegram !== "not_started" },
  { key: "email", label: "Email", href: "/dashboard/channels", connected: (i) => i.email !== "not_started" },
  { key: "web_chat", label: "your website widget", href: "/dashboard/widget", connected: (i) => i.hasWidgetKey },
];

/** Consistent badge tone/label across every channel card on the Channels
 *  page — same "connected/connecting/needs_attention/failed" vocabulary,
 *  regardless of which underlying model (Channel vs WhatsAppNumber) it came
 *  from. */
export function connectionStatusBadge(s: ConnectionStatus): { tone: "green" | "amber" | "rose" | "neutral"; label: string } {
  switch (s) {
    case "connected": return { tone: "green", label: "connected" };
    case "connecting": return { tone: "amber", label: "connecting" };
    case "needs_attention": return { tone: "amber", label: "needs attention" };
    case "failed": return { tone: "rose", label: "failed" };
    default: return { tone: "neutral", label: "not connected" };
  }
}

/** Channels the tenant said they wanted (Explore/Settings) that are still
 *  genuinely untouched — a channel mid-connection (e.g. WhatsApp stuck at
 *  "connecting") is NOT a gap, it's already in progress, so it's excluded
 *  here even though it isn't "connected" yet. Ordered by the tenant's OWN
 *  stated priority (their order in channelsNeeded), not a fixed app order. */
export function getChannelGaps(input: ChannelGapInput): ChannelGap[] {
  return GAP_DEFS
    .filter((d) => input.channelsNeeded.includes(d.key) && !d.connected(input))
    .map(({ key, label, href }) => ({ key, label, href, priority: input.channelsNeeded.indexOf(key) }))
    .sort((a, b) => a.priority - b.priority)
    .map(({ key, label, href }) => ({ key, label, href }));
}
