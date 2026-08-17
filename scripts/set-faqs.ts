/**
 * Set org-approved FAQs on EXISTING tenants without reseeding (preserves live
 * data: linked contacts, phone routing, conversations). These are the verbatim
 * answers the assistant is allowed to give for common general questions — the
 * org controls them; the AI never invents beyond them.
 *
 * Usage:
 *   npx tsx scripts/set-faqs.ts                 # apply defaults to all demo orgs
 *   npx tsx scripts/set-faqs.ts riverside       # just one org (defaults for it)
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Faq = { q: string; a: string };

// Sensible starter FAQs per demo org (the kind a front desk answers all day).
const DEFAULTS: Record<string, Faq[]> = {
  riverside: [
    { q: "What are the school hours / opening times?", a: "School runs Monday to Friday, 7:30am to 4:30pm. The office is open until 5:00pm." },
    { q: "When does the term end / term dates?", a: "Term 2 ends on 25 August 2026. Term 3 opens on 8 September 2026." },
    { q: "How can I pay school fees / payment methods?", a: "Fees can be paid via M-Pesa Paybill 400200 (account = your child's admission number), or by bank deposit to Riverside Academy, Equity Bank Acc 1234567890." },
    { q: "Where is the school located?", a: "Riverside Academy is on Riverside Drive, Nairobi, opposite the Riverside Shopping Centre." },
    { q: "How do I contact the school office?", a: "You can reach the school office on 020 000 1234 or office@riverside.ac during working hours." },
  ],
  hamzone: [
    { q: "What are the office / working hours?", a: "Our offices are open Monday to Friday, 8:00am to 5:00pm." },
    { q: "When is payday?", a: "Salaries are processed on the 28th of every month." },
    { q: "How do I reach HR?", a: "You can reach HR at hr@hamzone.io or on extension 200." },
  ],
  "nairobi-hospital": [
    { q: "What are the visiting hours?", a: "General ward visiting hours are 11:00am–1:00pm and 4:00pm–6:00pm daily." },
    { q: "Where is the hospital / location?", a: "Nairobi Hospital is on Argwings Kodhek Road, Nairobi. Ample parking is available." },
    { q: "What is the emergency number?", a: "For emergencies call our 24-hour line on 0700 000 911." },
  ],
  "kilimani-retail": [
    { q: "What are your opening hours?", a: "We're open Monday to Saturday 9:00am–8:00pm, and Sunday 10:00am–6:00pm." },
    { q: "What is your returns policy?", a: "Unused items can be returned within 14 days with a receipt for a full refund or exchange." },
    { q: "Do you offer delivery?", a: "Yes — we deliver within Nairobi. Delivery is free for orders above KES 5,000." },
  ],
};

async function main() {
  const only = process.argv[2];
  const slugs = only ? [only] : Object.keys(DEFAULTS);
  for (const slug of slugs) {
    const faqs = DEFAULTS[slug];
    if (!faqs) {
      console.error(`No default FAQs for "${slug}" — skipping.`);
      continue;
    }
    const tenant = await db.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      console.error(`No tenant "${slug}" — skipping.`);
      continue;
    }
    await db.tenant.update({ where: { id: tenant.id }, data: { faqs: faqs as object } });
    console.log(`✓ Set ${faqs.length} FAQs on ${tenant.name}.`);
  }
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
