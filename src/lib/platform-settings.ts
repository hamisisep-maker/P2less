import "server-only";
import { db } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Platform-wide settings the super admin can change at runtime (stored in
// PlatformSetting) — never a hard requirement, every reader has a sane
// built-in default so the platform works correctly before an admin ever
// touches this. Kept intentionally simple (string key/value) rather than a
// large config object, so adding one more setting later never needs a schema
// migration.
// ─────────────────────────────────────────────────────────────────────────────

// Defaults mirror the original hardcoded constants in billing.ts — nothing
// changes for an existing deployment until an admin actually edits a value.
export const SETTING_DEFAULTS = {
  price_conversation_kes: 2, // what P2Less charges the ORG per WhatsApp conversation
  price_ai_kes: 1, // what P2Less charges the ORG per AI understanding request
  price_document_kes: 5, // what P2Less charges the ORG per generated document
  cost_conversation_kes: 1, // Meta's estimated WhatsApp conversation fee (admin-set, no public real-time API)
  cost_document_kes: 0.2, // estimated PDF generation cost (compute)
  ai_primary_provider: "", // "" = use AI_PROVIDER env var / auto-detect
  usd_to_kes_rate: 129, // for converting provider token pricing (always USD) to KES billing — keep current from an actual FX rate

  // ── Automated billing lifecycle (src/lib/billing-lifecycle.ts) ──────────
  billing_grace_period_days: 7, // days a tenant keeps service after renewal fails before auto-suspend
  billing_reminder_days: "7,3,1", // comma list — days before renewsAt to queue a reminder notification
  billing_max_retries: 3, // automated renewal-charge attempts before entering grace period
  billing_retry_interval_hours: 24, // gap between automated retry attempts
  billing_auto_suspend_enabled: 1, // 0/1 — kill switch for automated suspension specifically (suspension is the most consequential automated action)
  billing_auto_renew_charge_enabled: 1, // 0/1 — kill switch for firing automated STK pushes at all
  billing_reconciliation_window_hours: 1, // how long to wait for a payment webhook before flagging "unknown, needs investigation" instead of assuming failure

  // ── Priority 4: incident detection thresholds (src/lib/incident-detection.ts) ──
  incident_job_consecutive_failures: 5, // a background job failing this many times in a row opens an incident
  incident_ai_error_rate_pct: 10, // AI provider error rate over the window below that counts as "degraded"
  incident_ai_window_minutes: 15, // rolling window for the AI error-rate calculation
  incident_mpesa_callback_silence_minutes: 15, // no M-Pesa callback at all in this window = incident
  incident_reconciliation_unresolved_threshold: 10, // unresolved reconciliation items before an incident opens
  incident_stk_failure_min_sample_size: 5, // fewer STK attempts than this in the window = not enough signal to mean anything (2 attempts, both failed, shouldn't page anyone)
  incident_stk_failure_warning_pct: 20, // failure rate at/above this opens a "warning" incident (and below it auto-resolves one that's open)
  incident_stk_failure_critical_pct: 50, // failure rate at/above this opens/escalates to a "critical" incident
  incident_stk_failure_window_minutes: 15, // rolling window for the STK failure-rate calculation

  // ── Priority 5: support ticket SLA (src/lib/ticket-sla.ts) ──────────────
  sla_hours_urgent: 4, // hours from creation until an urgent-priority ticket is due
  sla_hours_high: 24,
  sla_hours_normal: 48,
  sla_hours_low: 96,
  incident_ticket_sla_breach_threshold: 5, // this many tickets breaching SLA at once opens an incident — "why is nobody responding?"

  // ── Priority 4: maintenance mode (src/lib/maintenance-actions.ts) ──────
  maintenance_enabled: 0, // 0/1 — whole-PLATFORM maintenance, distinct from a single Integration.enabled toggle
  maintenance_reason: "",
  maintenance_started_at: "",
  maintenance_expected_duration_minutes: 30,
  maintenance_message: "P2Less is undergoing scheduled maintenance. We'll be back shortly.",
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return row?.value ?? String(SETTING_DEFAULTS[key]);
}

export async function getSettingNumber(key: SettingKey): Promise<number> {
  const v = await getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : (SETTING_DEFAULTS[key] as number);
}

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.platformSetting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<SettingKey, string>;
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    out[key] = map.get(key) ?? String(SETTING_DEFAULTS[key]);
  }
  return out;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

// ── AI provider cost assumptions (separate model — one row per provider) ────
export async function getAiProviderCosts(): Promise<Record<string, number>> {
  const rows = await db.aiProviderConfig.findMany();
  return Object.fromEntries(rows.map((r) => [r.provider, r.costPerCallKes]));
}

export async function setAiProviderCost(provider: string, costPerCallKes: number): Promise<void> {
  await db.aiProviderConfig.upsert({
    where: { provider },
    create: { provider, costPerCallKes },
    update: { costPerCallKes },
  });
}

// Real, stable console/billing URLs — where the admin actually goes to add
// credit for each provider. Not fabricated; these are each provider's real
// account billing page as of the provider list wired into ai.ts.
export const AI_PROVIDER_TOPUP_URL: Record<string, string> = {
  google: "https://aistudio.google.com/app/billing",
  groq: "https://console.groq.com/settings/billing",
  cerebras: "https://cloud.cerebras.ai/platform/billing",
  openrouter: "https://openrouter.ai/settings/credits",
  anthropic: "https://console.anthropic.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  xai: "https://console.x.ai/team/default/billing",
};
