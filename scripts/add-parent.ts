/**
 * Register a WhatsApp number as a school PARENT, with a child + demo data
 * (fees, results, attendance, an appointment) so the full parent flow works.
 * Does NOT reseed.
 *
 * Usage:
 *   npx tsx scripts/add-parent.ts <tenantSlug> <phone> <studentName> [grade] [admissionId]
 * Example:
 *   npx tsx scripts/add-parent.ts riverside +254739536255 "Zawadi Mwangi" "Grade 4" STU-100
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const digits = (s: string) => s.replace(/[^\d]/g, "");

async function main() {
  const [slug, phone, studentName, grade = "Grade 4", admissionId = "STU-" + Math.floor(100 + Math.random() * 800)] = process.argv.slice(2);
  if (!slug || !phone || !studentName) {
    console.error('Usage: npx tsx scripts/add-parent.ts <tenantSlug> <phone> <studentName> [grade] [admissionId]');
    process.exit(1);
  }
  const tenant = await db.tenant.findUnique({ where: { slug } });
  if (!tenant) { console.error(`No tenant "${slug}".`); process.exit(1); }
  const addr = phone.startsWith("+") ? phone : "+" + digits(phone);

  // 1) The child in the school system, with demo data.
  const student = await db.demoStudent.upsert({
    where: { externalId: admissionId },
    create: { externalId: admissionId, name: studentName, grade, parentPhones: [addr], arrivedAt: "07:48" },
    update: { name: studentName, grade, parentPhones: [addr] },
  });
  await db.demoResult.deleteMany({ where: { studentId: student.id } });
  for (const [subject, score, g] of [["Mathematics", 84, "A-"], ["English", 78, "B+"], ["Science", 91, "A"]] as [string, number, string][]) {
    await db.demoResult.create({ data: { studentId: student.id, term: "Term 2", subject, score, grade: g } });
  }
  await db.demoFeeAccount.upsert({ where: { studentId: student.id }, create: { studentId: student.id, currency: "KES", billed: 42000, paid: 27000, dueDate: "2026-09-05" }, update: { billed: 42000, paid: 27000, dueDate: "2026-09-05" } });
  for (const d of ["2026-08-13", "2026-08-14", "2026-08-15"]) {
    await db.demoAttendance.create({ data: { studentId: student.id, date: d, status: "present" } }).catch(() => {});
  }
  await db.demoAppointment.deleteMany({ where: { studentId: student.id } });
  await db.demoAppointment.create({ data: { reference: "APT-" + admissionId, studentId: student.id, date: "2026-08-20", time: "11:00 AM", reason: "Parent-teacher review", status: "confirmed" } });

  // 2) The parent contact, pre-linked to that child.
  let contact = await db.contact.findFirst({ where: { tenantId: tenant.id, address: addr } });
  if (!contact) contact = await db.contact.create({ data: { tenantId: tenant.id, channelType: "whatsapp", address: addr } });
  await db.contact.update({ where: { id: contact.id }, data: { phoneVerified: true, grants: { students: [{ id: admissionId, name: studentName, grade }] } } });
  const role = await db.role.findUnique({ where: { tenantId_key: { tenantId: tenant.id, key: "parent" } } });
  if (role) await db.contactRole.upsert({ where: { contactId_roleId: { contactId: contact.id, roleId: role.id } }, create: { contactId: contact.id, roleId: role.id }, update: {} });

  console.log(`✓ ${addr} is now a parent of ${studentName} (${admissionId}, ${grade}) at ${tenant.name}.`);
  await db.$disconnect();
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
