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
await db.$disconnect();

if (tenantCount === 0) {
  console.log("[prod-start] Empty database — seeding demo data...");
  run("npx tsx prisma/seed.ts");
} else {
  console.log(`[prod-start] Database already has ${tenantCount} tenant(s) — skipping seed.`);
}

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
