#!/usr/bin/env node
// Production entrypoint (Railway `npm start`). SQLite lives on a mounted volume,
// so there's no separate migration step to run by hand — this does it on boot:
//   1. Sync the schema (safe/idempotent for additive changes; Prisma refuses and
//      exits non-zero on anything genuinely destructive, rather than guessing).
//   2. Seed demo data ONLY if the database is empty (first deploy) — never on a
//      redeploy, so live data is never touched or duplicated.
//   3. Start Next.js in the foreground, forwarding signals for clean shutdowns.
import { execSync, spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";

function run(cmd) {
  console.log(`[prod-start] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

run("npx prisma db push --skip-generate");

const db = new PrismaClient();
const tenantCount = await db.tenant.count();

if (tenantCount === 0) {
  console.log("[prod-start] Empty database — seeding demo data...");
  run("npx tsx prisma/seed.ts");
} else {
  console.log(`[prod-start] Database already has ${tenantCount} tenant(s) — skipping seed.`);
}

// Reconcile which tenant owns the REAL live WhatsApp number(s) from env — this
// runs on EVERY boot (not just first-seed) so it also corrects a value the seed
// assigned before an env var existed. A physical number can only route to ONE
// tenant, so any other tenant currently (wrongly) holding it is parked first.
const routes = [
  { slug: "hamzone", pnid: process.env.WHATSAPP_HAMZONE_PNID },
  { slug: "riverside", pnid: process.env.WHATSAPP_RIVERSIDE_PNID },
  { slug: "nairobi-hospital", pnid: process.env.WHATSAPP_HOSPITAL_PNID },
  { slug: "kilimani-retail", pnid: process.env.WHATSAPP_RETAIL_PNID },
].filter((r) => r.pnid);

for (const r of routes) {
  const conflicting = await db.whatsAppNumber.findMany({ where: { phoneNumberId: r.pnid, tenant: { slug: { not: r.slug } } } });
  for (const c of conflicting) {
    await db.whatsAppNumber.update({ where: { id: c.id }, data: { phoneNumberId: `WA_PNID_PARKED_${c.id}` } });
    console.log(`[prod-start] Parked conflicting number on a different tenant (was holding ${r.pnid}).`);
  }
  const tenant = await db.tenant.findUnique({ where: { slug: r.slug } });
  if (tenant) {
    const { count } = await db.whatsAppNumber.updateMany({ where: { tenantId: tenant.id }, data: { phoneNumberId: r.pnid } });
    if (count) console.log(`[prod-start] ${r.slug} → live number routed (phoneNumberId set).`);
  }
}

// Visibility: log the final routing table so it's inspectable via `railway logs`.
const numbers = await db.whatsAppNumber.findMany({ include: { tenant: true } });
for (const n of numbers) console.log(`[prod-start] number: ${n.phoneNumber} -> ${n.tenant.slug} (pnid: ${n.phoneNumberId})`);

await db.$disconnect();

const port = process.env.PORT || "3000";
console.log(`[prod-start] Starting Next.js on port ${port}...`);
// Windows needs shell:true to resolve npx.cmd, but combining that with an args
// array trips a Node deprecation warning — so pass one shell string there.
// Linux (Railway's runtime) resolves npx directly; no shell needed.
const isWin = process.platform === "win32";
const child = isWin
  ? spawn(`npx next start -p ${port}`, { stdio: "inherit", shell: true })
  : spawn("npx", ["next", "start", "-p", port], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
