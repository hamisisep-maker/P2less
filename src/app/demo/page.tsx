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
  const [numbers, contacts] = await runCrossTenant(() => Promise.all([
    db.whatsAppNumber.findMany({
      where: { status: "active" },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    }),
    db.contact.findMany({
      include: { tenant: { include: { numbers: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]));

  const orgs = numbers.map((n) => ({
    number: n.phoneNumber,
    name: n.displayName,
    department: n.department ?? "",
    slug: n.tenant.slug,
    industry: n.tenant.industry,
  }));

  const senders = contacts.map((c) => {
    const g = (c.grants as Record<string, { name: string }[]> | null) ?? {};
    const key = Object.keys(g)[0];
    const hint = key ? g[key].map((x) => x.name).join(", ") : "not a registered contact";
    return {
      phone: c.address,
      name: c.displayName ?? c.address,
      hint,
      orgNumber: c.tenant.numbers[0]?.phoneNumber ?? "",
    };
  });

  return <DemoClient orgs={orgs} senders={senders} />;
}
