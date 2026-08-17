/**
 * Add (or update) a Hamzone employee in the demo payroll system AND link a
 * WhatsApp number to them, so texting from that number is recognized immediately.
 * Does NOT reseed — safe to run against a live setup.
 *
 * Usage:
 *   npx tsx scripts/add-employee.ts <tenantSlug> <phone> <employeeId> <name> [title] [leaveDays] [netPay]
 * Example:
 *   npx tsx scripts/add-employee.ts hamzone +254711562526 EMP-200 "Fatima Yusuf" Accountant 15 124000
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const digits = (s: string) => s.replace(/[^\d]/g, "");

async function main() {
  const [slug, phone, empId, name, title = "Employee", leave = "21", net = "120000"] = process.argv.slice(2);
  if (!slug || !phone || !empId || !name) {
    console.error('Usage: npx tsx scripts/add-employee.ts <tenantSlug> <phone> <employeeId> <name> [title] [leaveDays] [netPay]');
    process.exit(1);
  }
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No tenant "${slug}".`); process.exit(1); }

  // 1) The external payroll record (what the connected system knows).
  const emp = await db.demoEmployee.upsert({
    where: { externalId: empId },
    create: { externalId: empId, name, title, phones: [phone], leaveBalance: parseInt(leave, 10) },
    update: { name, title, phones: [phone], leaveBalance: parseInt(leave, 10) },
  });
  await db.demoPayslip.deleteMany({ where: { employeeId: emp.id } });
  const netN = parseInt(net, 10);
  await db.demoPayslip.create({ data: { employeeId: emp.id, period: "2026-07", currency: "KES", gross: Math.round(netN * 1.3), deductions: Math.round(netN * 0.3), net: netN } });

  // 2) The P2Less contact, pre-linked to that employee record.
  const addr = phone.startsWith("+") ? phone : "+" + digits(phone);
  let contact = await db.contact.findFirst({ where: { tenantId: tenant.id, address: addr } });
  if (!contact) contact = await db.contact.create({ data: { tenantId: tenant.id, channelType: "whatsapp", address: addr, displayName: name } });
  await db.contact.update({ where: { id: contact.id }, data: { displayName: name, phoneVerified: true, grants: { employees: [{ id: empId, name }] } } });
  const role = await db.role.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "employee" } } });
  if (role) await db.contactRole.upsert({ where: { contactId_roleId: { contactId: contact.id, roleId: role.id } }, create: { contactId: contact.id, roleId: role.id }, update: {} });

  console.log(`✓ ${name} (${empId}) linked to ${addr} in ${tenant.name} — leave ${leave} days, net KES ${netN.toLocaleString()}.`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
