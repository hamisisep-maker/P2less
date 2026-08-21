import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { requestId as newRequestId } from "./crypto";
import { hasAdminPermission } from "./admin-authz";
import type { AdminPermission } from "./admin-permissions";
import type { CurrentUser } from "./auth";
import { dispatchChannel } from "./notification-channels";

// ─────────────────────────────────────────────────────────────────────────────
// The Notification Engine — Event → rule match → recipient resolution →
// channel adapter → delivery → retry → audit. Generalized (Priority 6) from
// what was a billing-only queueNotification() in billing-lifecycle.ts into
// the platform-wide "detection reaches a human" backbone: incidents, tickets,
// and SLA breaches now queue through the exact same rule/dedupe/retry
// machinery billing reminders always used — one engine, not one per feature.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 5;
const BACKOFF_MINUTES = [2, 5, 15, 60, 240];

// Platform-scoped events (no tenant owns them) resolve their recipients from
// whoever holds the AdminPermission that "owns" that kind of event — reusing
// the existing RBAC catalog rather than inventing a separate "who to notify"
// config.
const PLATFORM_EVENT_PERMISSION: Partial<Record<string, AdminPermission>> = {
  incident_critical: "incidents.manage",
  incident_opened: "incidents.manage",
  ticket_created: "tickets.manage",
  ticket_sla_breached: "tickets.manage",
  whatsapp_connection_failed: "integrations.manage",
  ai_provider_degraded: "providers.manage",
  onboard_signup_anomaly: "security.manage",
};

export async function resolveTenantRecipientEmail(tenantId: string): Promise<string | null> {
  const owner = await db.user.findFirst({
    where: { tenantId, userRoles: { some: { role: { key: "owner" } } } },
    orderBy: { createdAt: "asc" },
  });
  if (owner) return owner.email;
  const any = await db.user.findFirst({ where: { tenantId }, orderBy: { createdAt: "asc" } });
  return any?.email ?? null;
}

async function resolvePlatformRecipientEmails(permission: AdminPermission): Promise<string[]> {
  const admins = await db.user.findMany({
    where: { OR: [{ isSuperAdmin: true }, { adminRoleId: { not: null } }] },
    include: { tenant: true, userRoles: { include: { role: true } }, adminRole: true },
  });
  return admins.filter((u) => hasAdminPermission(u as unknown as CurrentUser, permission)).map((u) => u.email);
}

/** The engine's single write path. Queues one real Notification row per
 *  (matching enabled rule × resolved recipient) — idempotent per day via
 *  dedupeKey, so re-running the same check tick never double-queues. Actual
 *  delivery happens later, asynchronously, in runNotificationDispatchSweep —
 *  this function only ever decides WHO should hear about WHAT, never sends
 *  anything itself. */
export async function queueNotification(
  event: string,
  content: string,
  opts: { tenantId?: string; timingDays?: number; when?: Date; recipientEmailOverride?: string } = {},
): Promise<number> {
  const when = opts.when ?? new Date();
  const rules = await db.notificationRule.findMany({
    where: opts.timingDays != null ? { event, enabled: true, timingDays: opts.timingDays } : { event, enabled: true },
  });
  if (rules.length === 0) return 0;

  let recipients: (string | null)[];
  if (opts.recipientEmailOverride) recipients = [opts.recipientEmailOverride];
  else if (opts.tenantId) recipients = [await resolveTenantRecipientEmail(opts.tenantId)];
  else {
    const permission = PLATFORM_EVENT_PERMISSION[event];
    const emails = permission ? await resolvePlatformRecipientEmails(permission) : [];
    recipients = emails.length > 0 ? emails : [null]; // still queue honestly (visible, unassigned) even with zero resolved recipients
  }

  let queued = 0;
  for (const rule of rules) {
    for (const recipientEmail of recipients) {
      const scopeKey = opts.tenantId ?? "platform";
      const key = `${scopeKey}:${event}:${rule.channel}:${recipientEmail ?? "unassigned"}:${when.toISOString().slice(0, 10)}`;
      const existing = await db.notification.findUnique({ where: { dedupeKey: key } });
      if (existing) continue;
      await db.notification.create({
        data: { dedupeKey: key, tenantId: opts.tenantId ?? null, event, channel: rule.channel, scheduledFor: when, status: "queued", content, recipientEmail },
      }).catch(() => {});
      queued++;
    }
  }
  return queued;
}

function eventSubject(event: string): string {
  return `P2Less — ${event.replace(/_/g, " ")}`;
}

/** The dispatch job (registered as notification_dispatch_sweep in
 *  instrumentation.ts). Picks up anything queued or previously-failed-and-
 *  due-for-retry, attempts a real send via the channel adapter, and records
 *  the REAL outcome — never advances a row to "sent" without an actual
 *  successful provider call. Exponential backoff on failure; a channel with
 *  no provider configured is marked honestly, not retried forever. */
export async function runNotificationDispatchSweep(): Promise<{ dispatched: number; sent: number; failed: number; noProvider: number }> {
  const now = new Date();
  const pending = await db.notification.findMany({
    where: {
      status: { in: ["queued", "failed"] },
      retryCount: { lt: MAX_RETRIES },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    take: 100,
  });

  let sent = 0, failed = 0, noProvider = 0;
  for (const n of pending) {
    const result = await dispatchChannel(n.channel, { to: n.recipientEmail, subject: eventSubject(n.event), text: n.content ?? "" });
    if (result.ok) {
      await db.notification.update({ where: { id: n.id }, data: { status: "sent", sentAt: new Date(), error: null } });
      sent++;
    } else if ("noProvider" in result && result.noProvider) {
      await db.notification.update({ where: { id: n.id }, data: { status: "no_provider_configured", error: result.error } });
      noProvider++;
    } else {
      const retryCount = n.retryCount + 1;
      const terminal = retryCount >= MAX_RETRIES;
      const backoffMin = BACKOFF_MINUTES[Math.min(retryCount - 1, BACKOFF_MINUTES.length - 1)];
      await db.notification.update({
        where: { id: n.id },
        data: { status: "failed", error: result.error, retryCount, nextAttemptAt: terminal ? null : new Date(Date.now() + backoffMin * 60_000) },
      });
      failed++;
      if (terminal && n.tenantId) {
        await audit({ tenantId: n.tenantId, requestId: newRequestId(), actorType: "system", action: "notification.delivery_failed_terminal", success: false, detail: { event: n.event, channel: n.channel, retryCount, error: result.error } }).catch(() => {});
      }
    }
  }
  return { dispatched: pending.length, sent, failed, noProvider };
}
