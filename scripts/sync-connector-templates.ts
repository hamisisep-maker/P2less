// Idempotent: upserts the marketplace catalog (ConnectorTemplate) by
// reading each source connector's REAL, currently-live ConnectorAction rows
// from the database and copying them into a template — never hand-
// transcribed, so the catalog can't silently drift from what these
// connectors actually do. Safe to re-run any time the source connectors'
// actions change (e.g. after adding a new capability to Riverside School
// System in prisma/seed.ts) to keep the marketplace catalog current.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type DraftAction = {
  key: string;
  name: string;
  description: string;
  method: string;
  path: string;
  paramSchema: unknown;
  requiresConfirm: boolean;
  requiresStepUp: boolean;
  riskLevel: string;
};

const TEMPLATES: { key: string; name: string; description: string; category: string; sourceConnectorName: string; baseUrlHint: string }[] = [
  { key: "school_system", name: "School Management System", description: "Student results, fees, attendance, gate check-in, and parent-teacher appointment booking.", category: "school", sourceConnectorName: "Riverside School System", baseUrlHint: "https://your-school-system.example.com/api" },
  { key: "payroll_hr", name: "Payroll & HR System", description: "Employee payslips, leave requests and balance, and HR meeting scheduling.", category: "payroll", sourceConnectorName: "Hamzone Payroll & HR", baseUrlHint: "https://your-payroll-system.example.com/api" },
  { key: "hospital_pms", name: "Hospital Patient Management", description: "Patient appointment lookups.", category: "hospital", sourceConnectorName: "Nairobi Hospital PMS", baseUrlHint: "https://your-hospital-pms.example.com/api" },
  { key: "retail_orders", name: "Retail Order Tracking", description: "Customer order status lookups.", category: "retail", sourceConnectorName: "Kilimani Retail Orders", baseUrlHint: "https://your-retail-system.example.com/api" },
];

async function main() {
  let synced = 0;
  for (const t of TEMPLATES) {
    const source = await db.connector.findFirst({ where: { name: t.sourceConnectorName }, include: { actions: true } });
    if (!source) {
      console.log(`- ${t.key}: source connector "${t.sourceConnectorName}" not found, skipping`);
      continue;
    }
    const actions: DraftAction[] = source.actions
      .filter((a) => a.key !== "IDENTIFY") // internal onboarding capability, not a marketplace-relevant one
      .map((a) => ({
        key: a.key,
        name: a.name,
        description: a.description ?? "",
        method: a.method,
        path: a.path,
        paramSchema: a.paramSchema,
        requiresConfirm: a.requiresConfirm,
        requiresStepUp: a.requiresStepUp,
        riskLevel: a.riskLevel,
      }));
    await db.connectorTemplate.upsert({
      where: { key: t.key },
      create: { key: t.key, name: t.name, description: t.description, category: t.category, baseUrlHint: t.baseUrlHint, authType: source.authType, actions: actions as unknown as object },
      update: { name: t.name, description: t.description, category: t.category, baseUrlHint: t.baseUrlHint, authType: source.authType, actions: actions as unknown as object },
    });
    console.log(`✓ ${t.key}: synced ${actions.length} capabilities from "${t.sourceConnectorName}"`);
    synced++;
  }
  console.log(`\n${synced}/${TEMPLATES.length} template(s) synced.`);
}

main().finally(() => db.$disconnect());
