import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// The static catalog of every external dependency the platform relies on —
// name/provider/links/category. This is CONFIG DATA, not a component prop:
// per the spec, "do not hard-code the provider links into random
// components" — every admin page that needs a docs/dashboard/billing link
// reads it from here (via the Integration table this seeds), never from a
// literal URL typed into a .tsx file.
//
// syncIntegrationsCatalog() is an idempotent upsert — safe to call from a
// seed script or a startup hook. It never touches `enabled` on an existing
// row (an admin's on/off choice must survive a redeploy), only the
// descriptive fields (name/links/category) that come from code.
// ─────────────────────────────────────────────────────────────────────────────

export type IntegrationCatalogEntry = {
  key: string;
  category: "messaging" | "payments" | "ai" | "notification" | "infrastructure";
  name: string;
  provider: string;
  docsUrl?: string;
  providerDashboardUrl?: string;
  billingUrl?: string;
  configJson?: Record<string, unknown>;
};

export const INTEGRATIONS_CATALOG: IntegrationCatalogEntry[] = [
  {
    key: "whatsapp_cloud_api",
    category: "messaging",
    name: "WhatsApp Cloud API",
    provider: "Meta",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api",
    providerDashboardUrl: "https://business.facebook.com/wa/manage",
    billingUrl: "https://business.facebook.com/billing_hub",
  },
  {
    key: "mpesa_stk",
    category: "payments",
    name: "M-Pesa STK Push",
    provider: "Safaricom Daraja",
    docsUrl: "https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate",
    providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps",
    billingUrl: "https://developer.safaricom.co.ke",
  },
  {
    key: "mpesa_paybill",
    category: "payments",
    name: "M-Pesa PayBill",
    provider: "Safaricom Daraja (C2B)",
    docsUrl: "https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL",
    providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps",
  },
  {
    key: "mpesa_till",
    category: "payments",
    name: "M-Pesa Till / Buy Goods",
    provider: "Safaricom Daraja (C2B)",
    docsUrl: "https://developer.safaricom.co.ke/APIs/CustomerToBusinessRegisterURL",
    providerDashboardUrl: "https://developer.safaricom.co.ke/user/me/apps",
  },
  {
    key: "bank_transfer",
    category: "payments",
    name: "Bank Transfer",
    provider: "Manual statement reconciliation",
  },
  {
    key: "card",
    category: "payments",
    name: "Card Payments",
    provider: "Not integrated",
  },
  { key: "ai_google", category: "ai", name: "Gemini", provider: "Google", docsUrl: "https://ai.google.dev/docs", providerDashboardUrl: "https://aistudio.google.com", billingUrl: "https://aistudio.google.com/app/billing" },
  { key: "ai_groq", category: "ai", name: "Groq", provider: "Groq", docsUrl: "https://console.groq.com/docs", providerDashboardUrl: "https://console.groq.com", billingUrl: "https://console.groq.com/settings/billing" },
  { key: "ai_cerebras", category: "ai", name: "Cerebras", provider: "Cerebras", docsUrl: "https://inference-docs.cerebras.ai", providerDashboardUrl: "https://cloud.cerebras.ai", billingUrl: "https://cloud.cerebras.ai/platform/billing" },
  { key: "ai_openrouter", category: "ai", name: "OpenRouter", provider: "OpenRouter", docsUrl: "https://openrouter.ai/docs", providerDashboardUrl: "https://openrouter.ai", billingUrl: "https://openrouter.ai/settings/credits" },
  { key: "ai_anthropic", category: "ai", name: "Claude", provider: "Anthropic", docsUrl: "https://docs.anthropic.com", providerDashboardUrl: "https://console.anthropic.com", billingUrl: "https://console.anthropic.com/settings/billing" },
  { key: "ai_openai", category: "ai", name: "OpenAI", provider: "OpenAI", docsUrl: "https://platform.openai.com/docs", providerDashboardUrl: "https://platform.openai.com", billingUrl: "https://platform.openai.com/settings/organization/billing/overview" },
  { key: "ai_xai", category: "ai", name: "Grok", provider: "xAI", docsUrl: "https://docs.x.ai", providerDashboardUrl: "https://console.x.ai", billingUrl: "https://console.x.ai/team/default/billing" },
  {
    key: "email_provider",
    category: "notification",
    name: "Email",
    provider: "Not configured",
  },
  {
    key: "sms_provider",
    category: "notification",
    name: "SMS",
    provider: "Advanta SMS (pending)",
  },
  {
    key: "database",
    category: "infrastructure",
    name: "Database",
    provider: "SQLite (Railway volume)",
  },
  {
    key: "storage",
    category: "infrastructure",
    name: "Storage",
    provider: "Railway volume",
  },
];

export function catalogEntry(key: string): IntegrationCatalogEntry | undefined {
  return INTEGRATIONS_CATALOG.find((e) => e.key === key);
}

export async function syncIntegrationsCatalog(): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  for (const entry of INTEGRATIONS_CATALOG) {
    const existing = await db.integration.findUnique({ where: { key: entry.key } });
    await db.integration.upsert({
      where: { key: entry.key },
      create: {
        key: entry.key, category: entry.category, name: entry.name, provider: entry.provider,
        docsUrl: entry.docsUrl, providerDashboardUrl: entry.providerDashboardUrl, billingUrl: entry.billingUrl,
        configJson: entry.configJson as Prisma.InputJsonValue | undefined,
      },
      update: {
        // Never touch `enabled` — that's an admin decision, not code's to overwrite.
        category: entry.category, name: entry.name, provider: entry.provider,
        docsUrl: entry.docsUrl, providerDashboardUrl: entry.providerDashboardUrl, billingUrl: entry.billingUrl,
      },
    });
    if (existing) updated++; else created++;
  }
  return { created, updated };
}
