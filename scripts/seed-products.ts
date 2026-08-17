/**
 * Seed demo products for existing tenants WITHOUT reseeding the whole database
 * (preserves live data). Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/seed-products.ts              # all demo orgs
 *   npx tsx scripts/seed-products.ts riverside     # just one
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type ProductSeed = { name: string; description: string; price: number; category: string; sku: string };

const DEFAULTS: Record<string, ProductSeed[]> = {
  riverside: [
    { name: "School Sweater — Navy", description: "Official uniform sweater, all sizes", price: 1800, category: "Uniforms", sku: "UNI-SW-NVY" },
    { name: "School Backpack", description: "Durable, water-resistant, embroidered crest", price: 2500, category: "Uniforms", sku: "UNI-BAG-01" },
    { name: "Exercise Book Set (10 pack)", description: "200-page ruled exercise books", price: 900, category: "Stationery", sku: "STA-EX-10" },
  ],
  hamzone: [
    { name: "Company Polo Shirt", description: "Branded polo, all sizes", price: 1500, category: "Merchandise", sku: "MER-POLO-01" },
  ],
  "nairobi-hospital": [
    { name: "First Aid Kit — Home", description: "Basic home first aid kit", price: 2200, category: "Health Supplies", sku: "HEA-FAK-01" },
  ],
  "kilimani-retail": [
    { name: "Wireless Earbuds", description: "Bluetooth 5.0, 20hr battery", price: 3500, category: "Electronics", sku: "ELE-EAR-01" },
    { name: "Cotton T-Shirt", description: "Unisex, available in 4 colors", price: 1200, category: "Apparel", sku: "APP-TEE-01" },
    { name: "Reusable Water Bottle", description: "1L stainless steel", price: 900, category: "Home", sku: "HOM-BOT-01" },
    { name: "Phone Case", description: "Shockproof, fits most models", price: 700, category: "Electronics", sku: "ELE-CASE-01" },
  ],
};

async function main() {
  const only = process.argv[2];
  const slugs = only ? [only] : Object.keys(DEFAULTS);
  for (const slug of slugs) {
    const products = DEFAULTS[slug];
    if (!products) { console.error(`No default products for "${slug}" — skipping.`); continue; }
    const tenant = await db.tenant.findUnique({ where: { slug } });
    if (!tenant) { console.error(`No tenant "${slug}" — skipping.`); continue; }
    let created = 0;
    for (const p of products) {
      const existing = await db.product.findFirst({ where: { tenantId: tenant.id, sku: p.sku } });
      if (existing) continue;
      await db.product.create({ data: { tenantId: tenant.id, name: p.name, description: p.description, price: p.price, currency: "KES", category: p.category, sku: p.sku, inStock: true, active: true } });
      created++;
    }
    console.log(`✓ ${tenant.name}: ${created} new product(s) added (${products.length - created} already existed).`);
  }
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
