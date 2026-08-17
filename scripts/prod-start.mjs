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

// New permissions added in code don't retroactively apply to already-created
// Role rows — sync every boot so a fresh capability never silently locks out
// existing owners (see scripts/sync-owner-permissions.ts).
run("npx tsx scripts/sync-owner-permissions.ts");

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

// Reconcile the STANDING TEST PARENT link from env, every boot — so whichever
// real phone is used for testing (across local dev and every environment) sees
// the SAME recognized student, instead of production silently being a stranger
// to a number that's already linked locally. Mirrors scripts/add-parent.ts.
const tp = {
  slug: process.env.TEST_TENANT_SLUG,
  phone: process.env.TEST_PARENT_PHONE,
  name: process.env.TEST_STUDENT_NAME,
  grade: process.env.TEST_STUDENT_GRADE || "Grade 6",
  admissionId: process.env.TEST_STUDENT_ADMISSION_ID,
};
if (tp.slug && tp.phone && tp.name && tp.admissionId) {
  const tenant = await db.tenant.findUnique({ where: { slug: tp.slug } });
  if (tenant) {
    const student = await db.demoStudent.upsert({
      where: { externalId: tp.admissionId },
      create: { externalId: tp.admissionId, name: tp.name, grade: tp.grade, parentPhones: [tp.phone], arrivedAt: "07:48" },
      update: { name: tp.name, grade: tp.grade, parentPhones: [tp.phone] },
    });
    if ((await db.demoResult.count({ where: { studentId: student.id } })) === 0) {
      for (const [subject, score, g] of [["Mathematics", 84, "A-"], ["English", 78, "B+"], ["Science", 91, "A"]]) {
        await db.demoResult.create({ data: { studentId: student.id, term: "Term 2", subject, score, grade: g } });
      }
    }
    await db.demoFeeAccount.upsert({ where: { studentId: student.id }, create: { studentId: student.id, currency: "KES", billed: 42000, paid: 27000, dueDate: "2026-09-05" }, update: {} });
    if ((await db.demoAttendance.count({ where: { studentId: student.id } })) === 0) {
      for (const d of ["2026-08-13", "2026-08-14", "2026-08-15"]) {
        await db.demoAttendance.create({ data: { studentId: student.id, date: d, status: "present" } }).catch(() => {});
      }
    }
    await db.demoAppointment.upsert({
      where: { reference: "APT-" + tp.admissionId },
      create: { reference: "APT-" + tp.admissionId, studentId: student.id, date: "2026-08-20", time: "11:00 AM", reason: "Parent-teacher review", status: "confirmed" },
      update: {},
    });
    let contact = await db.contact.findFirst({ where: { tenantId: tenant.id, address: tp.phone } });
    if (!contact) contact = await db.contact.create({ data: { tenantId: tenant.id, channelType: "whatsapp", address: tp.phone } });
    await db.contact.update({ where: { id: contact.id }, data: { phoneVerified: true, grants: { students: [{ id: tp.admissionId, name: tp.name, grade: tp.grade }] } } });
    const role = await db.role.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "parent" } } });
    if (role) await db.contactRole.upsert({ where: { contactId_roleId: { contactId: contact.id, roleId: role.id } }, create: { contactId: contact.id, roleId: role.id }, update: {} });
    console.log(`[prod-start] Test parent linked: ${tp.phone} -> ${tp.name} (${tp.admissionId}) on ${tp.slug}.`);
  }
}

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
