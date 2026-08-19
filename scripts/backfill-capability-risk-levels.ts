// Idempotent: derives a meaningful riskLevel for every existing
// ConnectorAction from its already-configured requiresStepUp/requiresConfirm
// flags, instead of leaving the schema default "low" on everything. Pure
// classification — riskLevel isn't consulted by any execution-gating logic
// yet (see capability-gate.ts), so this changes no behavior, only labeling.
// Safe to re-run: only touches rows still at the default "low" with a
// stronger signal available; never downgrades a value an admin may have
// already hand-set.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

function deriveRiskLevel(a: { requiresStepUp: boolean; requiresConfirm: boolean; operation: string }): string {
  if (a.requiresStepUp) return "high"; // sensitive read/write behind step-up auth
  if (a.requiresConfirm || a.operation === "write") return "medium"; // a real write, even if unconfirmed
  return "low"; // ordinary read
}

async function main() {
  const actions = await db.connectorAction.findMany({
    select: { id: true, key: true, requiresStepUp: true, requiresConfirm: true, operation: true, riskLevel: true },
  });
  let updated = 0;
  for (const a of actions) {
    const derived = deriveRiskLevel(a);
    if (a.riskLevel !== "low" || derived === "low") {
      console.log(`- ${a.key}: riskLevel already "${a.riskLevel}", leaving as-is`);
      continue;
    }
    await db.connectorAction.update({ where: { id: a.id }, data: { riskLevel: derived } });
    console.log(`✓ ${a.key}: low -> ${derived}`);
    updated++;
  }
  console.log(`\n${updated}/${actions.length} action(s) updated.`);
}

main().finally(() => db.$disconnect());
