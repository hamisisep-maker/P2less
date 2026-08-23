import "server-only";
import { db } from "./db";

export type UsageType = "message_in" | "message_out" | "api_call" | "ai_request" | "document" | "tool_run";

/** Record a metered event (feeds plan-limit enforcement + future usage billing). */
export async function meter(tenantId: string, type: UsageType, quantity = 1): Promise<void> {
  try {
    await db.usageEvent.create({ data: { tenantId, type, quantity } });
  } catch {
    /* metering is best-effort */
  }
}

function startOfMonth(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Sum a usage type for the current billing month. */
export async function monthlyUsage(tenantId: string, type: UsageType): Promise<number> {
  const rows = await db.usageEvent.aggregate({
    where: { tenantId, type, createdAt: { gte: startOfMonth() } },
    _sum: { quantity: true },
  });
  return rows._sum.quantity ?? 0;
}

export type PlanLimits = {
  users?: number;
  messagesPerMonth?: number;
  connectors?: number;
  aiRequestsPerMonth?: number;
  documentsPerMonth?: number;
};

/**
 * Check whether a tenant is within plan limits for a given usage type.
 * Returns { ok, limit, used }. Unlimited when the limit is missing or <= 0.
 */
export async function checkLimit(
  tenantId: string,
  type: UsageType,
): Promise<{ ok: boolean; limit: number | null; used: number }> {
  const sub = await db.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  const limits = (sub?.plan.limits as PlanLimits | undefined) ?? {};
  const map: Partial<Record<UsageType, keyof PlanLimits>> = {
    message_in: "messagesPerMonth",
    message_out: "messagesPerMonth",
    ai_request: "aiRequestsPerMonth",
    document: "documentsPerMonth",
  };
  const limitKey = map[type];
  const limit = limitKey ? limits[limitKey] : undefined;
  if (!limit || limit <= 0) return { ok: true, limit: null, used: 0 };
  const used = await monthlyUsage(tenantId, type);
  return { ok: used < limit, limit, used };
}

/**
 * Same shape as checkLimit(), but for the two plan limits that are real
 * standing COUNTS (how many exist right now), not a monthly flow — "users"
 * and "connectors" were configurable in the plan editor but never actually
 * checked anywhere before this (Gap-002, found auditing the plan/entitlement
 * model 2026-08-23): a Free-tier tenant could invite unlimited staff or
 * connect unlimited external systems regardless of the plan's stated limit.
 */
export async function checkSeatLimit(
  tenantId: string,
  type: "users" | "connectors",
): Promise<{ ok: boolean; limit: number | null; used: number }> {
  const sub = await db.subscription.findUnique({
    where: { tenantId },
    include: { plan: true },
  });
  const limits = (sub?.plan.limits as PlanLimits | undefined) ?? {};
  const limit = limits[type];
  if (!limit || limit <= 0) return { ok: true, limit: null, used: 0 };
  const used = type === "users" ? await db.user.count({ where: { tenantId } }) : await db.connector.count({ where: { tenantId } });
  return { ok: used < limit, limit, used };
}
