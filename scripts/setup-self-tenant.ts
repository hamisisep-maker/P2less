// Idempotent: creates (or updates) the self-referential "P2Less" tenant that
// powers the live chat widget embedded on the public landing page itself —
// P2Less dogfooding its own product. Widget-only: no WhatsAppNumber, no
// Users/Roles, since nobody logs into this tenant's dashboard. Safe to
// re-run any number of times (dev, or via `railway ssh` against production).
//
// The FAQ list is imported from `src/lib/landing-content.ts` — the SAME list
// rendered as the on-page accordion, so the embedded widget's grounded
// answers can never drift from what a visitor reads on the page.
import { PrismaClient } from "@prisma/client";
import { LANDING_FAQS } from "../src/lib/landing-content";

const db = new PrismaClient();

const SLUG = "p2less";
const WIDGET_KEY = "wk_p2less_official";
const PROD_ORIGIN = "https://p2less-app-production.up.railway.app";

async function main() {
  const tenant = await db.tenant.upsert({
    where: { slug: SLUG },
    update: { faqs: LANDING_FAQS as object },
    create: {
      name: "P2Less",
      slug: SLUG,
      industry: "business",
      useCases: ["automate_conversations", "developer_api"],
      faqs: LANDING_FAQS as object,
      branding: { assistantName: "P2Less Assistant", primaryColor: "#0d9488" },
    },
  });
  console.log(`✓ Tenant "${tenant.name}" (${tenant.id}) — ${LANDING_FAQS.length} FAQs set.`);

  const branch = await db.branch.findFirst({ where: { tenantId: tenant.id } });
  if (!branch) {
    await db.branch.create({ data: { tenantId: tenant.id, name: "Main", kind: "branch", isDefault: true } });
    console.log(`✓ Created default "Main" branch.`);
  } else {
    console.log(`- Branch already exists, skipping.`);
  }

  const existingKey = await db.widgetKey.findUnique({ where: { key: WIDGET_KEY } });
  if (existingKey) {
    await db.widgetKey.update({
      where: { key: WIDGET_KEY },
      data: { active: true, allowedOrigins: [PROD_ORIGIN, "http://localhost:3001"] },
    });
    console.log(`- Widget key "${WIDGET_KEY}" already exists, refreshed allowed origins.`);
  } else {
    await db.widgetKey.create({
      data: { tenantId: tenant.id, key: WIDGET_KEY, allowedOrigins: [PROD_ORIGIN, "http://localhost:3001"], active: true },
    });
    console.log(`✓ Created widget key "${WIDGET_KEY}".`);
  }

  console.log("\nDone. This is idempotent — safe to re-run any time the FAQ list changes.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
