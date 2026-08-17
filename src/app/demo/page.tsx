import { db } from "@/lib/db";
import { DemoClient } from "./demo-client";

// The demo simulates messaging an ORGANIZATION's own WhatsApp number. You pick
// which organization number to message and which sender you are; P2Less routes
// by the destination number to the right tenant — exactly like the real webhook.
export default async function DemoPage() {
  const numbers = await db.whatsAppNumber.findMany({
    where: { status: "active" },
    include: { tenant: true },
    orderBy: { createdAt: "asc" },
  });
  const contacts = await db.contact.findMany({
    include: { tenant: { include: { numbers: true } } },
    orderBy: { createdAt: "asc" },
  });

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
