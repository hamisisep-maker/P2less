import "server-only";
import { db } from "./db";
import { getSettingNumber } from "./platform-settings";
import { openOrBumpIncident } from "./incident-detection";

const SLA_SETTING_KEY: Record<string, "sla_hours_urgent" | "sla_hours_high" | "sla_hours_normal" | "sla_hours_low"> = {
  urgent: "sla_hours_urgent", high: "sla_hours_high", normal: "sla_hours_normal", low: "sla_hours_low",
};

/** Called at ticket creation — a real deadline derived from priority, not a
 *  vague "SLA/deadline" field left empty. Configurable via platform-settings,
 *  never hard-coded. */
export async function computeSlaDeadline(priority: string): Promise<Date> {
  const key = SLA_SETTING_KEY[priority] ?? SLA_SETTING_KEY.normal;
  const hours = await getSettingNumber(key);
  return new Date(Date.now() + hours * 60 * 60_000);
}

/** Detects breaches (a ticket whose deadline passed, still open) and — if
 *  enough are breaching AT ONCE — opens a real incident ("why is nobody
 *  responding to customers?"), reusing the SAME idempotent openOrBumpIncident
 *  helper every other incident check uses, so repeated sweep ticks bump one
 *  incident rather than opening a new one each time. */
export async function runTicketSlaSweep(): Promise<{ breached: number; newlyBreached: number }> {
  const now = new Date();
  const overdue = await db.supportTicket.findMany({
    where: { status: { notIn: ["resolved", "closed"] }, slaDeadlineAt: { lt: now } },
    select: { id: true, number: true, slaBreached: true, tenantId: true },
  });

  const toMark = overdue.filter((t) => !t.slaBreached);
  if (toMark.length > 0) {
    await db.supportTicket.updateMany({ where: { id: { in: toMark.map((t) => t.id) } }, data: { slaBreached: true } });
  }

  const threshold = await getSettingNumber("incident_ticket_sla_breach_threshold");
  if (overdue.length >= threshold) {
    await openOrBumpIncident({
      severity: overdue.length >= threshold * 2 ? "critical" : "warning",
      source: "ticket_sla_breach",
      title: `${overdue.length} support ticket(s) have breached their SLA deadline`,
      detail: { breachedCount: overdue.length, threshold, ticketNumbers: overdue.slice(0, 30).map((t) => t.number ?? t.id) },
    });
  }

  return { breached: overdue.length, newlyBreached: toMark.length };
}
