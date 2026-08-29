import { db } from "@/lib/db";
import { runCrossTenant } from "@/lib/tenant-context";
import { DemoClient } from "./demo-client";

// Queries the DB, so it must render per-request, not be statically prerendered
// at build time (the DB isn't reachable during the build step, only at runtime).
export const dynamic = "force-dynamic";

// The demo simulates messaging an ORGANIZATION's own WhatsApp number. You pick
// which organization number to message and which sender you are; P2Less routes
// by the destination number to the right tenant — exactly like the real webhook.
export default async function DemoPage() {
  // Public, unauthenticated page — a genuinely intentional cross-tenant read
  // (lets a visitor pick any org/contact to simulate). Found broken in
  // production by the 2026-08-23 fail-closed rollout, same as the landing
  // page — public pages are a category the choke-point audit missed.
  // Curated demo roster only — the 4 tenants this demo was actually built
  // for (each has real sample prompts in demo-client.tsx's SAMPLES map).
  // Without this filter, every tenant ever created with an active WhatsApp
  // number shows up here, including one-off tenants from live testing —
  // a real bug found live, not just a cosmetic size request.
  const DEMO_SLUGS = ["hamzone", "riverside", "nairobi-hospital", "kilimani-retail"];

  // Every demo org is real Hamzone Technologies infrastructure except Hamzone
  // itself is the one it's fair to name outright — the others get a generic,
  // industry-shaped label instead of their specific (test) org name, so the
  // public demo doesn't read as "here are our real client names."
  const GENERIC_NAMES: Record<string, string> = {
    riverside: "School",
    "nairobi-hospital": "Hospital",
    "kilimani-retail": "Retail",
  };

  const [numbers, allContacts] = await runCrossTenant(() => Promise.all([
    db.whatsAppNumber.findMany({
      where: { status: "active", tenant: { slug: { in: DEMO_SLUGS } } },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    }),
    db.contact.findMany({
      where: { tenant: { slug: { in: DEMO_SLUGS } } },
      include: { tenant: { include: { numbers: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]));

  // A number mid-connection (verificationStatus: "connecting", no real
  // phoneNumber yet) can't be simulated against — nothing to route to.
  const orgs = numbers
    .filter((n): n is typeof n & { phoneNumber: string } => n.phoneNumber !== null)
    .map((n) => ({
      number: n.phoneNumber,
      name: GENERIC_NAMES[n.tenant.slug] ?? n.displayName,
      department: n.department ?? "",
      slug: n.tenant.slug,
      industry: n.tenant.industry,
    }));

  // Only real, linked contacts (a genuine name backed by a grant — a linked
  // student/patient/order/employee record), never the bare test phone
  // numbers accumulated from live testing — and at most 3 per org, so the
  // "you are messaging as" panel reads like a handful of real people, not a
  // dump of raw numbers.
  const PER_ORG_LIMIT = 3;
  const seenPerOrg: Record<string, number> = {};
  const senders = allContacts
    .map((c) => {
      const g = (c.grants as Record<string, { name: string }[]> | null) ?? {};
      const key = Object.keys(g)[0];
      const hint = key ? g[key].map((x) => x.name).join(", ") : "";
      return {
        phone: c.address,
        name: c.displayName ?? "",
        hint,
        orgNumber: c.tenant.numbers[0]?.phoneNumber ?? "",
      };
    })
    .filter((s) => s.name && s.hint && s.orgNumber)
    .filter((s) => {
      const n = (seenPerOrg[s.orgNumber] ?? 0);
      if (n >= PER_ORG_LIMIT) return false;
      seenPerOrg[s.orgNumber] = n + 1;
      return true;
    });

  return <DemoClient orgs={orgs} senders={senders} />;
}
