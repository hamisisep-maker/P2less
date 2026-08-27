#!/usr/bin/env node
// Production entrypoint (Railway `npm start`). SQLite lives on a mounted volume,
// so there's no separate migration step to run by hand — this does it on boot:
//   1. Sync the schema (safe/idempotent for additive changes; Prisma refuses and
//      exits non-zero on anything genuinely destructive, rather than guessing).
//      Real incident, 2026-08-24: this refusal ALSO fires on a genuinely-safe
//      change if it's the *type* of change Prisma statically can't prove safe
//      (e.g. adding ANY new unique constraint, even to a column with zero real
//      duplicates today) -- caused a real boot crash-loop when a new
//      Channel @@unique constraint shipped. If this ever happens again:
//      independently verify no real duplicates exist first (a debug route
//      querying the actual column, not a guess), THEN temporarily add
//      `--accept-data-loss` to the line below for exactly one deploy, confirm
//      the boot log shows a clean sync, and revert it in the very next commit.
//      Never leave the flag in permanently -- that would silently wave
//      through a future change that's genuinely destructive.
//   2. Seed demo data ONLY if the database is empty (first deploy) — never on a
//      redeploy, so live data is never touched or duplicated.
//   3. Start Next.js in the foreground, forwarding signals for clean shutdowns.
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

function run(cmd) {
  console.log(`[prod-start] $ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// One-time confirmation that nixpacks.toml's ffmpeg addition actually
// landed in the runtime image — logged, never fatal (voice-reply/Baileys
// media features degrade gracefully without it, this is just so a boot log
// read confirms it rather than discovering it's missing mid-feature).
try {
  const ffmpegVersion = execSync("ffmpeg -version", { encoding: "utf8" }).split("\n")[0];
  console.log(`[prod-start] ffmpeg present: ${ffmpegVersion}`);
} catch {
  console.log("[prod-start] ffmpeg NOT found on PATH.");
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

// Demo catalog products (idempotent — skips any SKU that already exists), so
// the business-catalog feature has something real to browse/order without a
// separate manual seeding step against the remote database.
run("npx tsx scripts/seed-products.ts");

// Integrations catalog (idempotent upsert, never touches an existing row's
// `enabled` — see the script's own header comment). Every boot, not just on
// first seed, so a NEW catalog entry added in code (e.g. whatsapp_baileys,
// 2026-08-26) actually appears as a real, toggleable row on /admin/
// integrations without a manual one-off script run against production — a
// SQLite-on-a-mounted-volume deployment like this one has no remote
// connection string `railway run` can target from a local machine, so this
// boot step is the only real way a new catalog entry reaches production.
run("npx tsx scripts/sync-integrations-catalog.ts");

// Prepaid billing, 2026-08-25 — one-time-per-subscription balance migration.
// Every subscription that existed before the prepaid-balance gate shipped has
// messageBalanceKes/aiBalanceKes at their schema default of 0, which would
// otherwise silently block 100% of its real traffic the instant the gate went
// live (confirmed live: the local regression suite went from 73/73 to 31/73
// passing, every failure the balance-exhausted fallback, until this ran).
// Runs every boot like the reconciliation steps below, but is itself
// idempotent per-subscription via balanceMigratedAt (not "balance is 0"), so
// a subscription that legitimately runs its real balance down through normal
// usage is never re-granted a free top-up on a later boot. Mirrors (not
// imports — this script can't import anything tagged "server-only", see
// src/lib/prepaid-billing.ts's own migrateSubscriptionBalances(), used by
// local dev instead) the same logic inline.
{
  const [msgSetting, aiSetting] = await Promise.all([
    db.platformSetting.findUnique({ where: { key: "migration_grant_messages_kes" } }),
    db.platformSetting.findUnique({ where: { key: "migration_grant_ai_kes" } }),
  ]);
  const messagesGrant = msgSetting ? Number(msgSetting.value) : 500;
  const aiGrant = aiSetting ? Number(aiSetting.value) : 250;
  const pending = await db.subscription.findMany({
    where: { balanceMigratedAt: null, status: { not: "trial" }, plan: { postpaidUsage: false } },
    select: { id: true },
  });
  for (const s of pending) {
    await db.subscription.update({
      where: { id: s.id },
      data: { messageBalanceKes: messagesGrant, aiBalanceKes: aiGrant, balanceMigratedAt: new Date() },
    });
  }
  if (pending.length) console.log(`[prod-start] Prepaid balance migration: granted ${pending.length} subscription(s) ${messagesGrant}/${aiGrant} KES starting balance.`);
}

// Phase 3, 2026-08-26 — Channel.connectionStatus is a new column; every
// pre-existing Channel row gets Prisma's schema default ("not_started") even
// though many of them are genuinely already connected. One-time correction
// from the OLD status field, every boot — naturally idempotent because once
// a row moves off "not_started" it never matches this WHERE clause again
// (new rows write connectionStatus explicitly at creation from now on, so
// they're never stuck at the default in the first place).
{
  const activeToConnected = await db.channel.updateMany({
    where: { connectionStatus: "not_started", status: "active" },
    data: { connectionStatus: "connected" },
  });
  const pendingToNeedsAttention = await db.channel.updateMany({
    where: { connectionStatus: "not_started", status: "pending" },
    data: { connectionStatus: "needs_attention" },
  });
  if (activeToConnected.count || pendingToNeedsAttention.count) {
    console.log(`[prod-start] Channel connectionStatus backfill: ${activeToConnected.count} -> connected, ${pendingToNeedsAttention.count} -> needs_attention.`);
  }
}

// Phase 4, 2026-08-26 — TenantInterestEvent is a brand-new table, so every
// tenant that already had useCases/channelsNeeded set before this phase
// shipped has no history at all. Give each such tenant one baseline "added"
// event per current value, source: "backfill", so the admin trend chart has
// a coherent starting point instead of a gap. Idempotent via the zero-events
// check — a tenant that already has ANY real event (from this backfill or a
// genuine later change) never matches again.
{
  const tenants = await db.tenant.findMany({
    select: { id: true, useCases: true, channelsNeeded: true },
  });
  let backfilled = 0;
  for (const t of tenants) {
    const useCases = t.useCases ?? [];
    const channelsNeeded = t.channelsNeeded ?? [];
    if (useCases.length === 0 && channelsNeeded.length === 0) continue;
    const existing = await db.tenantInterestEvent.count({ where: { tenantId: t.id } });
    if (existing > 0) continue;
    await db.tenantInterestEvent.createMany({
      data: [
        ...useCases.map((value) => ({ tenantId: t.id, source: "backfill", field: "useCases", value, action: "added" })),
        ...channelsNeeded.map((value) => ({ tenantId: t.id, source: "backfill", field: "channelsNeeded", value, action: "added" })),
      ],
    });
    backfilled++;
  }
  if (backfilled) console.log(`[prod-start] TenantInterestEvent backfill: ${backfilled} tenant(s) given a baseline history.`);
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

// Real gap found live, 2026-08-27 — the landing page's pricing cards and
// P2Less's own FAQ both advertise the Free plan as "2 users, 200
// messages/mo, 1 connector, 100 AI requests/mo, 20 documents/mo," but the
// real `Plan.key: "free"` row every signup actually gets (finalizeOnboarding
// in actions.ts) only had `{ messagesPerMonth: 50, aiRequestsPerMonth: 30 }`
// — under a third of what's promised, with no users/connectors/documents
// ceiling set at all. A real trial user would hit a wall at 50 messages
// while being told they get 200 — exactly the wrong moment to break a
// promise. Raising the real limit to match the advertised copy (not the
// other way around) — the copy is what a prospect actually read and decided
// to sign up against.
{
  const free = await db.plan.findUnique({ where: { key: "free" } });
  if (free) {
    const limits = { users: 2, connectors: 1, messagesPerMonth: 200, aiRequestsPerMonth: 100, documentsPerMonth: 20 };
    const current = JSON.stringify(free.limits ?? {});
    if (current !== JSON.stringify(limits)) {
      await db.plan.update({ where: { id: free.id }, data: { limits } });
      console.log("[prod-start] Free plan limits corrected to match advertised copy (200 msgs/mo, 100 AI requests/mo, 2 users, 1 connector, 20 docs/mo).");
    }
  }
}

// P2Less's own internal-training tenant, 2026-08-26 — direct request. This
// tenant was created directly (via the landing-page/FAQ work), never through
// the real finalizeOnboarding() signup flow, so it has zero Role rows and no
// owner login — idempotent, one-time provisioning here, mirroring exactly
// what finalizeOnboarding() itself does (actions.ts), inlined because that
// file (and permissions.ts, which it imports) carry "server-only" — the same
// constraint documented in sync-integrations-catalog.ts's own header comment.
// A dedicated "internal" Plan (priceMonthly: 0, postpaidUsage: true, active:
// false so it's never selectable in any real customer-facing picker) is used
// instead of reusing "enterprise" — reusing Enterprise would inflate the
// platform's own real Enterprise-tenant count with a non-paying internal
// account. postpaidUsage: true exempts it from the prepaid balance gate
// (isGateExempt() in prepaid-billing.ts) — usage is still meter()-ed/tracked
// exactly like any other tenant, this only skips the top-up requirement.
{
  const p2less = await db.tenant.findFirst({ where: { name: "P2Less" } });
  if (p2less) {
    if (p2less.status !== "active") {
      await db.tenant.update({ where: { id: p2less.id }, data: { status: "active" } });
      console.log("[prod-start] P2Less tenant reactivated.");
    }

    let internalPlan = await db.plan.findUnique({ where: { key: "internal" } });
    if (!internalPlan) {
      internalPlan = await db.plan.create({
        data: { key: "internal", name: "Internal", priceMonthly: 0, postpaidUsage: true, active: false, sort: 999, limits: {} },
      });
      console.log("[prod-start] Internal plan created (KES 0/mo, postpaid-exempt, hidden from real customers).");
    }
    if (!(await db.subscription.findUnique({ where: { tenantId: p2less.id } }))) {
      await db.subscription.create({
        data: { tenantId: p2less.id, planId: internalPlan.id, period: "monthly", status: "active", renewsAt: new Date(Date.now() + 365 * 864e5) },
      });
      console.log("[prod-start] P2Less subscription created on the Internal plan.");
    }

    if ((await db.user.count({ where: { tenantId: p2less.id } })) === 0) {
      let ownerRole = await db.role.findFirst({ where: { tenantId: p2less.id, key: "owner" } });
      if (!ownerRole) {
        ownerRole = await db.role.create({
          data: {
            tenantId: p2less.id, key: "owner", name: "Organization Owner", isSystem: true,
            permissions: [
              "tenant.manage", "users.manage", "connectors.manage", "conversations.read", "audit.read",
              "billing.manage", "developer.manage", "products.manage", "delivery.manage", "drivers.manage",
              "student.results.read", "student.balance.read", "student.attendance.read", "student.report.read",
              "school.info.read", "appointment.read", "appointment.book",
            ],
          },
        });
      }
      const password = crypto.randomBytes(9).toString("base64url"); // shown once, right here, never stored in plaintext
      const owner = await db.user.create({
        data: { tenantId: p2less.id, name: "Hamisi Onesmus", email: "admin@p2less.internal", passwordHash: await bcrypt.hash(password, 10) },
      });
      await db.userRole.create({ data: { userId: owner.id, roleId: ownerRole.id } });
      console.log(`[prod-start] P2Less owner created — email: ${owner.email} · password: ${password} (shown once, save it now)`);
    }
  }
}

// Real gap found live, 2026-08-27 — a webchat test asking "can you read
// images and listen to voice notes? what about replying with voice?" got
// back "we don't do voice outputs — the assistant communicates purely
// through text across every channel." Flatly wrong: image vision and
// voice-note replies both shipped and were live-verified in production
// earlier this same week (GAP-REGISTER-2026-08-24.md items 23/26). Read the
// real stored faqs (logged via a prior diagnostic-only version of this
// block, since this SQLite volume has no remote connection string a local
// script can query directly) — none of the 30 existing FAQs mention media
// capabilities at all, so the assistant was guessing rather than grounding,
// on a question its own "Does the assistant ever make things up? No" FAQ
// promises it won't do. Scoped to WhatsApp specifically (both transports),
// not a blanket claim — Messenger's inbound handler passes attachments
// through generically but was never wired for transcription/voice-reply the
// way WhatsApp's was, so it isn't claimed here. Idempotent: only appends if
// this exact question isn't already present, safe to leave in permanently
// (matches the shape of every other one-time P2Less-tenant fix in this file).
{
  const p2less = await db.tenant.findFirst({ where: { name: "P2Less" }, select: { id: true, faqs: true } });
  if (p2less) {
    const faqs = Array.isArray(p2less.faqs) ? p2less.faqs : [];
    const q = "Can it understand images and voice notes, and reply with voice?";
    if (!faqs.some((f) => f?.q === q)) {
      faqs.push({
        q,
        a: "Yes, on WhatsApp — send a photo and it reads any text in it (receipts, documents, screenshots) and describes what's in it; send a voice note and it listens and understands it, then replies back with a real voice note of its own, not just text. This website chat is text-only for now.",
      });
      await db.tenant.update({ where: { id: p2less.id }, data: { faqs } });
      console.log("[prod-start] P2Less FAQ corrected — added real answer for image/voice capability question.");
    }
  }
}

// One-time cleanup, 2026-08-26 — repeated "Connect via alternative" clicks
// (each one unconditionally creates a new WhatsAppNumber row, no "resume the
// existing attempt" logic) left a pile of dangling unofficial-transport rows
// for P2Less that never actually finished pairing (phoneNumber still null).
// Every redeploy's rehydrateAllBaileysConnections() was retrying every one
// of these on every boot — real log noise, and real UI clutter on
// /dashboard/channels.
//
// Real incident, 2026-08-26: this originally deleted EVERY phoneNumber:null
// row unconditionally — including one whose pairing had just been RESET
// seconds earlier via "Forget & pair again" (which deliberately nulls
// phoneNumber to force a fresh handshake) and was still mid-pairing when a
// deploy's boot happened to land. The row got deleted before pairing could
// finish, silently orphaning its real conversation history (Conversation.
// numberId is a nullable FK — Prisma's default SetNull meant no messages
// were actually lost, but the connection itself had to be rebuilt from
// scratch). Now scoped to rows old enough that they're genuinely abandoned
// test debris, not a pairing attempt still in flight.
{
  const p2less = await db.tenant.findFirst({ where: { name: "P2Less" } });
  if (p2less) {
    const { count } = await db.whatsAppNumber.deleteMany({
      where: { tenantId: p2less.id, transport: "unofficial", phoneNumber: null, createdAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
    });
    if (count > 0) console.log(`[prod-start] Cleaned up ${count} unfinished P2Less unofficial-transport pairing attempt(s).`);
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
