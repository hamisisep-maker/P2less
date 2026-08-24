import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "../src/lib/admin-permissions";

// Inline copies of the two crypto helpers the seed needs (the app's crypto.ts is
// "server-only" and can't be imported from a plain tsx script).
function encKey(): Buffer {
  const raw = process.env.CREDENTIAL_KEY || "";
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  return crypto.createHash("sha256").update(raw || "p2less-dev-credential-key").digest();
}
function encryptJSON(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value))), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

const db = new PrismaClient();

const PERM = {
  TENANT_MANAGE: "tenant.manage", USERS_MANAGE: "users.manage", CONNECTORS_MANAGE: "connectors.manage",
  CONVERSATIONS_READ: "conversations.read", AUDIT_READ: "audit.read", BILLING_MANAGE: "billing.manage",
  DEVELOPER_MANAGE: "developer.manage",
  STUDENT_RESULTS_READ: "student.results.read", STUDENT_BALANCE_READ: "student.balance.read",
  STUDENT_ATTENDANCE_READ: "student.attendance.read", STUDENT_REPORT_READ: "student.report.read",
  SCHOOL_INFO_READ: "school.info.read",
  APPOINTMENT_READ: "appointment.read", APPOINTMENT_BOOK: "appointment.book",
  PAYSLIP_READ: "payslip.read", LEAVE_READ: "leave.read", LEAVE_SUBMIT: "leave.submit", ORDER_READ: "order.read",
  MEETING_MANAGE: "meeting.manage",
};

async function main() {
  console.log("Seeding P2Less platform…");

  // ── Reset (idempotent) ──────────────────────────────────────────────────
  await db.$transaction([
    db.auditLog.deleteMany(), db.usageEvent.deleteMany(), db.document.deleteMany(),
    db.message.deleteMany(), db.otpChallenge.deleteMany(), db.authSession.deleteMany(),
    db.supportTicket.deleteMany(), db.conversation.deleteMany(), db.whatsAppNumber.deleteMany(),
    db.contactRole.deleteMany(), db.userRole.deleteMany(),
    db.connectorAction.deleteMany(), db.connector.deleteMany(),
    db.channel.deleteMany(), db.contact.deleteMany(), db.role.deleteMany(),
    db.apiKey.deleteMany(), db.webhook.deleteMany(),
    db.subscription.deleteMany(), db.userSession.deleteMany(), db.loginAttempt.deleteMany(),
    db.user.deleteMany(), db.adminRole.deleteMany(), db.tenant.deleteMany(),
    db.demoResult.deleteMany(), db.demoAttendance.deleteMany(), db.demoFeeAccount.deleteMany(),
    db.demoAppointment.deleteMany(), db.demoStudent.deleteMany(),
    db.demoAnnouncement.deleteMany(), db.demoTimetableSlot.deleteMany(),
    db.demoMeeting.deleteMany(), db.demoLeaveRequest.deleteMany(), db.demoPayslip.deleteMany(), db.demoEmployee.deleteMany(),
    db.demoPatient.deleteMany(), db.demoOrder.deleteMany(),
    db.plan.deleteMany(),
  ]);

  // ── Plans (configurable, not hard-coded into app logic) ─────────────────
  // Prepaid billing redesign, 2026-08-25: "free" is now an INTERNAL-ONLY row
  // (active: false, never shown to a customer) that holds the admin-
  // configurable trial allowance every new signup gets before choosing a
  // real plan — see finalizeOnboarding's key:"free" lookup and Plan's own
  // schema comment. "starter" is the real, cheapest publicly-selectable
  // plan (there is no plan literally called "Free" a customer can see — a
  // direct product decision, not an oversight). Only "enterprise" carries
  // postpaidUsage: true — every other plan uses the new prepaid message/AI
  // balance model.
  const [free, starter, professional, business] = await Promise.all([
    db.plan.create({ data: { key: "free", name: "Trial allowance (internal)", priceMonthly: 0, active: false, sort: -1, limits: { messagesPerMonth: 50, aiRequestsPerMonth: 30 } } }),
    db.plan.create({ data: { key: "starter", name: "Starter", priceMonthly: 1500, sort: 0, limits: { users: 5, connectors: 3 } } }),
    db.plan.create({ data: { key: "professional", name: "Professional", priceMonthly: 4900, sort: 1, limits: { users: 15, connectors: 10 } } }),
    db.plan.create({ data: { key: "business", name: "Business", priceMonthly: 19900, sort: 2, limits: { users: 60, connectors: 50 } } }),
    db.plan.create({ data: { key: "enterprise", name: "Enterprise", priceMonthly: 0, whiteLabel: true, sort: 3, postpaidUsage: true, limits: {} } }),
  ]);

  // ── Platform admin RBAC: the 6 built-in roles (Users → Roles → Permissions
  // → Resources → Actions → Scope → Audit — see src/lib/admin-permissions.ts
  // for the full permission catalog and profile of each role). Not fixed
  // forever: a Super Admin can create additional custom roles at /admin/roles. ─
  const adminRoles: Record<BuiltInRoleKey, { id: string }> = {} as never;
  for (const [key, def] of Object.entries(BUILT_IN_ROLES) as [BuiltInRoleKey, typeof BUILT_IN_ROLES[BuiltInRoleKey]][]) {
    adminRoles[key] = await db.adminRole.create({ data: { key, name: def.name, permissions: def.permissions, isBuiltIn: true } });
  }

  // ── Platform super admin ────────────────────────────────────────────────
  const pw = await bcrypt.hash("password", 10);
  await db.user.create({ data: { name: "P2Less Admin", email: "admin@p2less.io", passwordHash: pw, isSuperAdmin: true, adminRoleId: adminRoles.super_admin.id } });

  // ── Tenant: Riverside Academy ───────────────────────────────────────────
  const tenant = await db.tenant.create({
    data: {
      name: "Riverside Academy", slug: "riverside", industry: "school", status: "active",
      branding: { assistantName: "Riverside Assistant", primaryColor: "#0f766e", welcome: "Welcome to Riverside Academy. I can help with results, fees, attendance and more.", poweredBy: "Powered by P2Less", pdfFooter: "Riverside Academy · Official Report" },
      // Org-approved FAQs the assistant may answer verbatim (editable at /dashboard/faqs).
      faqs: [
        { q: "What are the school hours / opening times?", a: "School runs Monday to Friday, 7:30am to 4:30pm. The office is open until 5:00pm." },
        { q: "When does the term end / term dates?", a: "Term 2 ends on 25 August 2026. Term 3 opens on 8 September 2026." },
        { q: "How can I pay school fees / payment methods?", a: "Fees can be paid via M-Pesa Paybill 400200 (account = your child's admission number), or by bank deposit to Riverside Academy, Equity Bank Acc 1234567890." },
        { q: "Where is the school located?", a: "Riverside Academy is on Riverside Drive, Nairobi, opposite the Riverside Shopping Centre." },
        { q: "How do I contact the school office?", a: "You can reach the school office on 020 000 1234 or office@riverside.ac during working hours." },
      ],
    },
  });
  await db.subscription.create({ data: { tenantId: tenant.id, planId: professional.id, period: "monthly", status: "active", renewsAt: new Date(Date.now() + 30 * 864e5) } });

  // Roles (staff + contacts)
  const mkRole = (key: string, name: string, permissions: string[]) =>
    db.role.create({ data: { tenantId: tenant.id, key, name, isSystem: true, permissions } });
  const ownerRole = await mkRole("owner", "Organization Owner", Object.values(PERM));
  const adminRole = await mkRole("admin", "Organization Admin", [PERM.USERS_MANAGE, PERM.CONNECTORS_MANAGE, PERM.CONVERSATIONS_READ, PERM.AUDIT_READ, PERM.DEVELOPER_MANAGE]);
  await mkRole("integration_manager", "Integration Manager", [PERM.CONNECTORS_MANAGE, PERM.CONVERSATIONS_READ]);
  const parentRole = await mkRole("parent", "Parent / Guardian", [PERM.STUDENT_RESULTS_READ, PERM.STUDENT_BALANCE_READ, PERM.STUDENT_ATTENDANCE_READ, PERM.STUDENT_REPORT_READ, PERM.SCHOOL_INFO_READ, PERM.APPOINTMENT_READ, PERM.APPOINTMENT_BOOK]);
  const endUserRole = await mkRole("end_user", "End User", [PERM.SCHOOL_INFO_READ]);

  // Staff users
  const grace = await db.user.create({ data: { tenantId: tenant.id, name: "Grace Mwangi", email: "grace@riverside.ac", passwordHash: pw } });
  const sarah = await db.user.create({ data: { tenantId: tenant.id, name: "Sarah Otieno", email: "sarah@riverside.ac", passwordHash: pw } });
  await db.userRole.create({ data: { userId: grace.id, roleId: ownerRole.id } });
  await db.userRole.create({ data: { userId: sarah.id, roleId: adminRole.id } });

  // Channels + the organization's WhatsApp number (the front door users message).
  await db.channel.create({ data: { tenantId: tenant.id, type: "webchat", status: "active" } });
  await db.whatsAppNumber.create({ data: { tenantId: tenant.id, phoneNumber: "+254711000001", displayName: "Riverside Academy", department: "General", phoneNumberId: "WA_PNID_RIVERSIDE", status: "active", verificationStatus: "verified" } });

  // ── DEMO EXTERNAL SCHOOL SYSTEM data (third-party; reached only via HTTP) ─
  const mkStudent = async (externalId: string, name: string, grade: string, parentPhones: string[], arrivedAt: string | null) => {
    const s = await db.demoStudent.create({ data: { externalId, name, grade, parentPhones, arrivedAt, leftAt: null } });
    return s;
  };
  const john = await mkStudent("STU-001", "John Kimani", "Grade 6", ["+254700000001"], "07:52");
  const mary = await mkStudent("STU-014", "Mary Kimani", "Grade 3", ["+254700000001"], null);
  const brianK = await mkStudent("STU-021", "Brian Kamau", "Grade 6", ["+254700000002"], "07:41");
  const brianO = await mkStudent("STU-022", "Brian Otieno", "Grade 8", ["+254700000002"], "07:58");

  const results: [string, string, number, string][] = [
    ["Mathematics", "Term 2", 82, "A-"], ["English", "Term 2", 76, "B+"], ["Science", "Term 2", 88, "A"], ["Kiswahili", "Term 2", 71, "B"],
  ];
  for (const [subject, term, score, grade] of results) {
    await db.demoResult.create({ data: { studentId: john.id, subject, term, score, grade } });
  }
  await db.demoResult.create({ data: { studentId: mary.id, subject: "Mathematics", term: "Term 2", score: 90, grade: "A" } });
  await db.demoResult.create({ data: { studentId: mary.id, subject: "English", term: "Term 2", score: 85, grade: "A-" } });
  const brianKResults: [string, number, string][] = [["Mathematics", 74, "B"], ["English", 80, "A-"], ["Science", 69, "B-"]];
  for (const [subject, score, grade] of brianKResults) await db.demoResult.create({ data: { studentId: brianK.id, subject, term: "Term 2", score, grade } });
  const brianOResults: [string, number, string][] = [["Mathematics", 91, "A"], ["English", 88, "A"], ["History", 84, "A-"]];
  for (const [subject, score, grade] of brianOResults) await db.demoResult.create({ data: { studentId: brianO.id, subject, term: "Term 2", score, grade } });

  await db.demoFeeAccount.create({ data: { studentId: john.id, currency: "KES", billed: 45000, paid: 26500, dueDate: "2026-09-05" } });
  await db.demoFeeAccount.create({ data: { studentId: mary.id, currency: "KES", billed: 38000, paid: 38000, dueDate: "2026-09-05" } });
  await db.demoFeeAccount.create({ data: { studentId: brianK.id, currency: "KES", billed: 45000, paid: 10000, dueDate: "2026-09-05" } });
  await db.demoFeeAccount.create({ data: { studentId: brianO.id, currency: "KES", billed: 52000, paid: 52000, dueDate: "2026-09-05" } });

  const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13"];
  for (const d of days) await db.demoAttendance.create({ data: { studentId: john.id, date: d, status: d === "2026-08-11" ? "late" : "present" } });

  await db.demoAnnouncement.create({ data: { title: "Term 2 Parents' Meeting", body: "All parents are invited to the Term 2 review meeting in the main hall.", eventDate: "2026-08-22" } });
  await db.demoAnnouncement.create({ data: { title: "Mid-term Break", body: "School closes for mid-term break.", eventDate: "2026-09-01" } });

  // A pre-existing appointment so "when is my next appointment?" returns data.
  await db.demoAppointment.create({ data: { reference: "APT-SEED", studentId: john.id, date: "2026-08-18", time: "10:30 AM", reason: "Term 2 progress review", status: "confirmed" } });

  const timetable: [string, number, string][] = [
    ["monday", 1, "Mathematics"], ["monday", 2, "English"], ["monday", 3, "Science"],
    ["tuesday", 1, "Kiswahili"], ["tuesday", 2, "Mathematics"], ["tuesday", 3, "Social Studies"],
  ];
  for (const [day, period, subject] of timetable) await db.demoTimetableSlot.create({ data: { grade: "Grade 6", day, period, subject } });

  // ── Contacts (conversational end users) + their authorization grants ─────
  // Amina is the authorized parent of John + Mary. Grants are the ground truth
  // for what she may access — populated (in production) from the school system.
  const amina = await db.contact.create({
    data: {
      tenantId: tenant.id, channelType: "webchat", address: "+254700000001", displayName: "Amina Kimani",
      phoneVerified: true, grants: { students: [{ id: "STU-001", name: "John Kimani", grade: "Grade 6" }, { id: "STU-014", name: "Mary Kimani", grade: "Grade 3" }] },
    },
  });
  await db.contactRole.create({ data: { contactId: amina.id, roleId: parentRole.id } });

  // A parent with two children both named "Brian" — for the ambiguity demo.
  const joseph = await db.contact.create({
    data: {
      tenantId: tenant.id, channelType: "webchat", address: "+254700000002", displayName: "Joseph Kamau",
      phoneVerified: true, grants: { students: [{ id: "STU-021", name: "Brian Kamau", grade: "Grade 6" }, { id: "STU-022", name: "Brian Otieno", grade: "Grade 8" }] },
    },
  });
  await db.contactRole.create({ data: { contactId: joseph.id, roleId: parentRole.id } });

  // An unlinked visitor — no student grants — to demonstrate authorization denial.
  const david = await db.contact.create({
    data: { tenantId: tenant.id, channelType: "webchat", address: "+254700000009", displayName: "David (unlinked)", grants: {} },
  });
  await db.contactRole.create({ data: { contactId: david.id, roleId: endUserRole.id } });

  // ── Connector → the demo school system (real HTTP + api key) ─────────────
  const baseUrl = `${process.env.P2LESS_BASE_URL || "http://localhost:3000"}/api/demo-school`;
  const connector = await db.connector.create({
    data: {
      tenantId: tenant.id, name: "Riverside School System", description: "Student information system (results, fees, attendance).",
      kind: "rest", baseUrl, authType: "api_key",
      authConfigEnc: encryptJSON({ type: "api_key", header: "x-api-key", value: process.env.DEMO_SCHOOL_API_KEY || "demo-school-api-key-riverside" }),
      timeoutMs: 8000, maxRetries: 1, status: "active",
    },
  });

  const studentParam = [{ name: "studentId", in: "path", required: true, from: "entity", entity: "studentId" }];
  const mkAction = (a: Record<string, unknown>) => db.connectorAction.create({ data: { connectorId: connector.id, ...a } as never });

  await mkAction({
    key: "GET_STUDENT_BALANCE", name: "Get student fee balance", operation: "read", method: "GET",
    path: "/students/{studentId}/balance", paramSchema: studentParam,
    responseMapping: { name: "student.name", currency: "currency", balance: "balance", dueDate: "dueDate", billed: "billed", paid: "paid" },
    requiredPermission: PERM.STUDENT_BALANCE_READ, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, documentKind: "fee_statement",
    samplePhrases: ["fee balance", "how much do I owe", "school fees balance", "what is the balance", "fees", "outstanding fees", "fee statement", "amount due", "school fees", "pending fees", "balance"],
    replyTemplate: "{name}'s fee balance is {currency} {balance}. It's due by {dueDate}.",
  });
  await mkAction({
    key: "GET_STUDENT_RESULTS", name: "Get student exam results", operation: "read", method: "GET",
    path: "/students/{studentId}/results", paramSchema: studentParam,
    responseMapping: { name: "student.name", average: "average", summary: "summary" },
    requiredPermission: PERM.STUDENT_RESULTS_READ, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: true, documentKind: "report_card",
    samplePhrases: ["exam results", "show results", "marks", "how did he do", "report", "grades"],
    replyTemplate: "Here are {name}'s latest results:\n{summary}\nOverall average: {average}%.",
  });
  await mkAction({
    key: "GET_STUDENT_ATTENDANCE", name: "Get student attendance", operation: "read", method: "GET",
    path: "/students/{studentId}/attendance", paramSchema: studentParam,
    responseMapping: { name: "student.name", rate: "rate", present: "present", absent: "absent", late: "late" },
    requiredPermission: PERM.STUDENT_ATTENDANCE_READ, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, samplePhrases: ["attendance", "how many days present", "absences", "attendance record"],
    replyTemplate: "{name} has a {rate}% attendance record — {present} days present, {late} late, {absent} absent.",
  });
  await mkAction({
    key: "GET_STUDENT_GATE", name: "Has the student arrived at school", operation: "read", method: "GET",
    path: "/students/{studentId}/gate", paramSchema: studentParam,
    responseMapping: { name: "student.name", status: "status", arrivedAt: "arrivedAt" },
    requiredPermission: PERM.STUDENT_ATTENDANCE_READ, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, samplePhrases: ["has he arrived", "did she arrive at school", "is he at school", "arrived at school", "check in"],
    replyTemplate: "Gate status for {name}: {status} (arrived {arrivedAt}).",
  });
  await mkAction({
    key: "GET_NEXT_MEETING", name: "Next parents meeting / announcement", operation: "read", method: "GET",
    path: "/announcements/next", paramSchema: [],
    responseMapping: { title: "title", body: "body", eventDate: "eventDate" },
    requiredPermission: PERM.SCHOOL_INFO_READ, requiresStepUp: false,
    samplePhrases: ["next parents meeting", "when is the meeting", "upcoming events", "announcement", "school calendar"],
    replyTemplate: "{title} — {eventDate}. {body}",
  });

  // Read: the student's next booked appointment.
  await mkAction({
    key: "GET_NEXT_APPOINTMENT", name: "Get next appointment", operation: "read", method: "GET",
    path: "/students/{studentId}/appointments/next", paramSchema: studentParam,
    responseMapping: { name: "student.name", date: "date", time: "time", reason: "reason", has: "hasAppointment" },
    requiredPermission: PERM.APPOINTMENT_READ, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, samplePhrases: ["next appointment", "when is my appointment", "upcoming appointment", "do I have a meeting booked"],
    replyTemplate: "{name}'s next appointment is on {date} at {time} ({reason}).",
  });

  // WRITE: book a parent-teacher appointment. Multi-step (date, time) + confirm.
  await mkAction({
    key: "BOOK_APPOINTMENT", name: "Book a parent-teacher appointment", operation: "write", method: "POST",
    path: "/appointments",
    paramSchema: [
      { name: "studentId", in: "body", required: true, from: "entity", entity: "studentId" },
      { name: "date", in: "body", required: true, from: "entity", entity: "date" },
      { name: "time", in: "body", required: true, from: "entity", entity: "time" },
      { name: "reason", in: "body", required: false, from: "entity", entity: "reason" },
    ],
    responseMapping: { name: "student.name", reference: "reference", date: "date", time: "time" },
    requiredPermission: PERM.APPOINTMENT_BOOK, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["book an appointment", "book a meeting", "schedule a meeting", "make an appointment", "meet the teacher", "book meeting with class teacher"],
    confirmTemplate: "You're about to book a meeting for {studentName} on {date} at {time}.",
    replyTemplate: "✓ Booked! Meeting for {name} on {date} at {time}. Reference: {reference}.",
  });
  // UPDATE: reschedule the next appointment (PATCH) — the "U" in CRUD.
  await mkAction({
    key: "RESCHEDULE_APPOINTMENT", name: "Reschedule an appointment", operation: "write", method: "PATCH",
    path: "/students/{studentId}/appointments/next",
    paramSchema: [
      { name: "studentId", in: "path", required: true, from: "entity", entity: "studentId" },
      { name: "date", in: "body", required: true, from: "entity", entity: "date" },
      { name: "time", in: "body", required: false, from: "entity", entity: "time" },
    ],
    responseMapping: { name: "student.name", date: "date", time: "time", reference: "reference" },
    requiredPermission: PERM.APPOINTMENT_BOOK, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["reschedule appointment", "change my appointment", "move my appointment", "reschedule the meeting", "change appointment date", "postpone my appointment"],
    confirmTemplate: "Reschedule {studentName}'s appointment to {date}?",
    replyTemplate: "✓ Rescheduled! {name}'s appointment is now on {date} at {time}. (Ref {reference})",
  });
  // DELETE: cancel the next appointment (DELETE) — the "D" in CRUD.
  await mkAction({
    key: "CANCEL_APPOINTMENT", name: "Cancel an appointment", operation: "write", method: "DELETE",
    path: "/students/{studentId}/appointments/next",
    paramSchema: [{ name: "studentId", in: "path", required: true, from: "entity", entity: "studentId" }],
    responseMapping: { name: "student.name", reference: "reference", status: "status" },
    requiredPermission: PERM.APPOINTMENT_BOOK, resourceGrantKey: "students", resourceParam: "studentId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["cancel appointment", "cancel my appointment", "cancel the meeting", "delete my appointment", "remove my appointment", "call off my appointment"],
    confirmTemplate: "Cancel {studentName}'s appointment? This can't be undone.",
    replyTemplate: "✓ Cancelled. {name}'s appointment (ref {reference}) has been cancelled.",
  });
  // Internal onboarding capability: verify a child's admission number against the guardian's phone.
  await mkAction({
    key: "IDENTIFY", name: "Identify parent by admission number", operation: "read", method: "POST", path: "/identify",
    paramSchema: [
      { name: "id", in: "body", required: true, from: "entity", entity: "id" },
      { name: "phone", in: "body", required: true, from: "entity", entity: "phone" },
    ],
    responseMapping: { matched: "matched", name: "name", personId: "id" },
    requiredPermission: null, requiresStepUp: false, samplePhrases: [],
  });

  // ════════════════════════════════════════════════════════════════════════
  // Additional organizations — each behind its OWN number, tenant, connector
  // and external system. Proves number → tenant routing + strict isolation.
  // ════════════════════════════════════════════════════════════════════════
  const baseFor = (p: string) => `${process.env.P2LESS_BASE_URL || "http://localhost:3000"}${p}`;

  // ── HAMZONE TECHNOLOGIES → +254711562526 → Payroll/HR ───────────────────
  const hamzone = await db.tenant.create({
    data: {
      name: "Hamzone Technologies", slug: "hamzone", industry: "business", status: "active",
      branding: { assistantName: "Hamzone Technologies", primaryColor: "#4f46e5", poweredBy: "Powered by P2Less" },
    },
  });
  await db.subscription.create({ data: { tenantId: hamzone.id, planId: professional.id, period: "monthly", status: "active", renewsAt: new Date(Date.now() + 30 * 864e5) } });
  // A couple of prior payments so the billing history isn't empty.
  await db.payment.create({ data: { tenantId: hamzone.id, reference: "PAY-JUN26", amount: 6100, currency: "KES", purpose: "subscription", method: "mpesa", status: "paid", provider: "manual", periodLabel: "2026-06", paidAt: new Date("2026-06-30") } });
  await db.payment.create({ data: { tenantId: hamzone.id, reference: "PAY-JUL26", amount: 6350, currency: "KES", purpose: "subscription", method: "mpesa", status: "paid", provider: "manual", periodLabel: "2026-07", paidAt: new Date("2026-07-31") } });
  // Demo developer API key (fixed plaintext for docs/tests): p2l_demo_hamzone_readonly_key
  await db.apiKey.create({ data: { tenantId: hamzone.id, name: "Demo key", prefix: "p2l_demo_hamz", keyHash: crypto.createHash("sha256").update("p2l_demo_hamzone_readonly_key").digest("hex"), scopes: ["conversations.read", "numbers.read", "capabilities.read", "usage.read", "messages.write", "webhooks.write"] } });
  await db.whatsAppNumber.create({ data: { tenantId: hamzone.id, phoneNumber: "+254711562526", displayName: "Hamzone Technologies", department: "HR & Payroll", phoneNumberId: process.env.WHATSAPP_HAMZONE_PNID || "WA_PNID_HAMZONE", status: "active", verificationStatus: "verified" } });
  const hamOwnerRole = await db.role.create({ data: { tenantId: hamzone.id, key: "owner", name: "Organization Owner", isSystem: true, permissions: Object.values(PERM) } });
  const employeeRole = await db.role.create({ data: { tenantId: hamzone.id, key: "employee", name: "Employee", isSystem: true, permissions: [PERM.PAYSLIP_READ, PERM.LEAVE_READ, PERM.LEAVE_SUBMIT, PERM.MEETING_MANAGE] } });
  const zainab = await db.user.create({ data: { tenantId: hamzone.id, name: "Zainab Ali", email: "zainab@hamzone.io", passwordHash: pw } });
  await db.userRole.create({ data: { userId: zainab.id, roleId: hamOwnerRole.id } });
  // External payroll system data
  const amir = await db.demoEmployee.create({ data: { externalId: "EMP-184", name: "Amir Hassan", title: "Software Engineer", phones: ["+254739536255"], leaveBalance: 18 } });
  await db.demoPayslip.create({ data: { employeeId: amir.id, period: "2026-07", currency: "KES", gross: 180000, deductions: 42000, net: 138000 } });
  // An employee whose WhatsApp is NOT pre-linked — used to demo self-service onboarding.
  const graceEmp = await db.demoEmployee.create({ data: { externalId: "EMP-190", name: "Grace Njeri", title: "Accountant", phones: ["+254799111222"], leaveBalance: 12 } });
  await db.demoPayslip.create({ data: { employeeId: graceEmp.id, period: "2026-07", currency: "KES", gross: 150000, deductions: 33000, net: 117000 } });
  // Employee contact (self-service: single employee grant)
  const amirContact = await db.contact.create({ data: { tenantId: hamzone.id, channelType: "webchat", address: "+254739536255", displayName: "Amir Hassan", phoneVerified: true, grants: { employees: [{ id: "EMP-184", name: "Amir Hassan", detail: "Software Engineer" }] } } });
  await db.contactRole.create({ data: { contactId: amirContact.id, roleId: employeeRole.id } });
  // Connector → payroll (its own API key)
  const payrollConnector = await db.connector.create({
    data: {
      tenantId: hamzone.id, name: "Hamzone Payroll & HR", description: "Payroll and HR system.", kind: "rest",
      baseUrl: baseFor("/api/demo-payroll"), authType: "api_key",
      authConfigEnc: encryptJSON({ type: "api_key", header: "x-api-key", value: process.env.DEMO_PAYROLL_API_KEY || "demo-payroll-key-hamzone" }),
      timeoutMs: 8000, maxRetries: 1, status: "active",
    },
  });
  const empParam = [{ name: "employeeId", in: "path", required: true, from: "entity", entity: "employeeId" }];
  const mkHam = (a: Record<string, unknown>) => db.connectorAction.create({ data: { connectorId: payrollConnector.id, ...a } as never });
  await mkHam({
    key: "GET_MY_PAYSLIP", name: "Get my payslip", operation: "read", method: "GET",
    path: "/employees/{employeeId}/payslip", paramSchema: empParam,
    responseMapping: { name: "employee.name", period: "period", currency: "currency", net: "net", gross: "gross", deductions: "deductions" },
    requiredPermission: PERM.PAYSLIP_READ, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: true, documentKind: "payslip",
    samplePhrases: ["my payslip", "send me my payslip", "salary slip", "pay slip", "payslip", "salary", "my pay", "how much did I earn", "pay details", "income", "my wages", "pay statement"],
    replyTemplate: "Here's your payslip for {period} 💰\n• Net pay: {currency} {net}\n• Gross: {currency} {gross}\n• Deductions: {currency} {deductions}",
  });
  // WRITE: submit a leave request. Multi-step (start/end date) + confirmation.
  await mkHam({
    key: "SUBMIT_LEAVE_REQUEST", name: "Request leave", operation: "write", method: "POST",
    path: "/leave-requests",
    paramSchema: [
      { name: "employeeId", in: "body", required: true, from: "entity", entity: "employeeId" },
      { name: "startDate", in: "body", required: true, from: "entity", entity: "startDate" },
      { name: "endDate", in: "body", required: true, from: "entity", entity: "endDate" },
      { name: "reason", in: "body", required: false, from: "entity", entity: "reason" },
    ],
    responseMapping: { name: "employee.name", reference: "reference", startDate: "startDate", endDate: "endDate", status: "status", reason: "reason" },
    requiredPermission: PERM.LEAVE_SUBMIT, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, requiresConfirm: true, documentKind: "leave",
    samplePhrases: ["request leave", "apply for leave", "book leave", "take leave", "i want leave", "submit leave request", "leave application", "go on leave", "day off request", "annual leave request"],
    confirmTemplate: "You're requesting leave from {startDate} to {endDate}. Reply CONFIRM to submit.",
    replyTemplate: "✅ Leave request submitted! Reference {reference} ({startDate} → {endDate}), status: {status}. Your manager will review it.",
  });
  await mkHam({
    key: "GET_MY_LEAVE_BALANCE", name: "Get my leave balance", operation: "read", method: "GET",
    path: "/employees/{employeeId}/leave-balance", paramSchema: empParam,
    responseMapping: { name: "employee.name", leaveBalance: "leaveBalance", unit: "unit" },
    requiredPermission: PERM.LEAVE_READ, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, samplePhrases: ["leave balance", "how many leave days", "leave days remaining", "my leave", "days off", "vacation days", "annual leave", "holiday balance", "how much leave do I have", "leave days left", "time off"],
    replyTemplate: "You have {leaveBalance} {unit} of leave remaining. 🌴",
  });
  // Internal onboarding capability: verify an Employee ID against the sender's phone.
  await mkHam({
    key: "IDENTIFY", name: "Identify employee", operation: "read", method: "POST", path: "/identify",
    paramSchema: [
      { name: "id", in: "body", required: true, from: "entity", entity: "id" },
      { name: "phone", in: "body", required: true, from: "entity", entity: "phone" },
    ],
    responseMapping: { matched: "matched", name: "name", personId: "id" },
    requiredPermission: null, requiresStepUp: false, samplePhrases: [],
  });
  // ── Meeting CRUD (so employees can book/manage a meeting over WhatsApp) ──
  await mkHam({
    key: "BOOK_MEETING", name: "Book a meeting", operation: "write", method: "POST", path: "/meetings",
    paramSchema: [
      { name: "employeeId", in: "body", required: true, from: "entity", entity: "employeeId" },
      { name: "date", in: "body", required: true, from: "entity", entity: "date" },
      { name: "time", in: "body", required: true, from: "entity", entity: "time" },
      { name: "topic", in: "body", required: false, from: "entity", entity: "topic" },
    ],
    responseMapping: { name: "employee.name", reference: "reference", date: "date", time: "time" },
    requiredPermission: PERM.MEETING_MANAGE, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["book a meeting", "schedule a meeting", "book an appointment", "meet my manager", "book meeting with hr", "arrange a meeting", "set up a meeting"],
    confirmTemplate: "Book a meeting for {resourceName} on {date} at {time}?",
    replyTemplate: "✓ Meeting booked for {date} at {time}. Reference {reference}. HR will confirm.",
  });
  await mkHam({
    key: "GET_MY_MEETING", name: "Get my next meeting", operation: "read", method: "GET",
    path: "/employees/{employeeId}/meetings/next", paramSchema: empParam,
    responseMapping: { name: "employee.name", date: "date", time: "time", topic: "topic", has: "hasMeeting" },
    requiredPermission: PERM.MEETING_MANAGE, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, samplePhrases: ["my next meeting", "when is my meeting", "upcoming meeting", "do I have a meeting"],
    replyTemplate: "Your next meeting is on {date} at {time} ({topic}).",
  });
  await mkHam({
    key: "RESCHEDULE_MEETING", name: "Reschedule my meeting", operation: "write", method: "PATCH",
    path: "/employees/{employeeId}/meetings/next",
    paramSchema: [
      { name: "employeeId", in: "path", required: true, from: "entity", entity: "employeeId" },
      { name: "date", in: "body", required: true, from: "entity", entity: "date" },
      { name: "time", in: "body", required: false, from: "entity", entity: "time" },
    ],
    responseMapping: { name: "employee.name", date: "date", time: "time", reference: "reference" },
    requiredPermission: PERM.MEETING_MANAGE, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["reschedule my meeting", "change my meeting", "move my meeting", "postpone my meeting"],
    confirmTemplate: "Reschedule {resourceName}'s meeting to {date}?",
    replyTemplate: "✓ Rescheduled! Your meeting is now on {date} at {time}. (Ref {reference})",
  });
  await mkHam({
    key: "CANCEL_MEETING", name: "Cancel my meeting", operation: "write", method: "DELETE",
    path: "/employees/{employeeId}/meetings/next",
    paramSchema: [{ name: "employeeId", in: "path", required: true, from: "entity", entity: "employeeId" }],
    responseMapping: { name: "employee.name", reference: "reference", status: "status" },
    requiredPermission: PERM.MEETING_MANAGE, resourceGrantKey: "employees", resourceParam: "employeeId",
    requiresStepUp: false, requiresConfirm: true,
    samplePhrases: ["cancel my meeting", "cancel the meeting", "delete my meeting", "call off my meeting"],
    confirmTemplate: "Cancel {resourceName}'s meeting? This can't be undone.",
    replyTemplate: "✓ Cancelled. Your meeting (ref {reference}) has been cancelled.",
  });

  // ── NAIROBI HOSPITAL → +254711000002 → Patient management ───────────────
  const hospital = await db.tenant.create({
    data: { name: "Nairobi Hospital", slug: "nairobi-hospital", industry: "hospital", status: "active", branding: { assistantName: "Nairobi Hospital", primaryColor: "#0369a1", poweredBy: "Powered by P2Less" } },
  });
  await db.subscription.create({ data: { tenantId: hospital.id, planId: business.id, period: "monthly", status: "active", renewsAt: new Date(Date.now() + 30 * 864e5) } });
  await db.whatsAppNumber.create({ data: { tenantId: hospital.id, phoneNumber: "+254711000002", displayName: "Nairobi Hospital", department: "Appointments", phoneNumberId: "WA_PNID_HOSPITAL", status: "active", verificationStatus: "verified" } });
  const hospOwnerRole = await db.role.create({ data: { tenantId: hospital.id, key: "owner", name: "Organization Owner", isSystem: true, permissions: Object.values(PERM) } });
  const patientRole = await db.role.create({ data: { tenantId: hospital.id, key: "patient", name: "Patient", isSystem: true, permissions: [PERM.APPOINTMENT_READ] } });
  const drOtieno = await db.user.create({ data: { tenantId: hospital.id, name: "Dr. Otieno", email: "admin@nairobihospital.io", passwordHash: pw } });
  await db.userRole.create({ data: { userId: drOtieno.id, roleId: hospOwnerRole.id } });
  await db.demoPatient.create({ data: { externalId: "PT-5521", name: "Faith Wanjiru", phones: ["+254739000010"], nextApptDate: "2026-08-20", nextApptTime: "9:00 AM", nextApptDept: "Dental" } });
  const faithContact = await db.contact.create({ data: { tenantId: hospital.id, channelType: "webchat", address: "+254739000010", displayName: "Faith Wanjiru", phoneVerified: true, grants: { patients: [{ id: "PT-5521", name: "Faith Wanjiru" }] } } });
  await db.contactRole.create({ data: { contactId: faithContact.id, roleId: patientRole.id } });
  const hospConnector = await db.connector.create({
    data: {
      tenantId: hospital.id, name: "Nairobi Hospital PMS", description: "Patient management system.", kind: "rest",
      baseUrl: baseFor("/api/demo-hospital"), authType: "api_key",
      authConfigEnc: encryptJSON({ type: "api_key", header: "x-api-key", value: process.env.DEMO_HOSPITAL_API_KEY || "demo-hospital-key-nairobi" }),
      timeoutMs: 8000, maxRetries: 1, status: "active",
    },
  });
  await db.connectorAction.create({
    data: {
      connectorId: hospConnector.id, key: "GET_NEXT_APPOINTMENT", name: "Get my next appointment", operation: "read", method: "GET",
      path: "/patients/{patientId}/appointment/next",
      paramSchema: [{ name: "patientId", in: "path", required: true, from: "entity", entity: "patientId" }],
      responseMapping: { name: "patient.name", date: "date", time: "time", department: "department", has: "hasAppointment" },
      requiredPermission: PERM.APPOINTMENT_READ, resourceGrantKey: "patients", resourceParam: "patientId",
      requiresStepUp: false, samplePhrases: ["next appointment", "when is my appointment", "my appointment", "upcoming appointment"],
      replyTemplate: "Your next appointment is on {date} at {time} in {department}. See you then! 🏥",
    } as never,
  });

  // ── KILIMANI RETAIL → +254711000003 → Order management ──────────────────
  const retail = await db.tenant.create({
    data: { name: "Kilimani Retail", slug: "kilimani-retail", industry: "business", status: "active", branding: { assistantName: "Kilimani Retail", primaryColor: "#b45309", poweredBy: "Powered by P2Less" } },
  });
  await db.subscription.create({ data: { tenantId: retail.id, planId: starter.id, period: "monthly", status: "active", renewsAt: new Date(Date.now() + 30 * 864e5) } });
  await db.whatsAppNumber.create({ data: { tenantId: retail.id, phoneNumber: "+254711000003", displayName: "Kilimani Retail", department: "Customer Care", phoneNumberId: "WA_PNID_RETAIL", status: "active", verificationStatus: "verified" } });
  const retOwnerRole = await db.role.create({ data: { tenantId: retail.id, key: "owner", name: "Organization Owner", isSystem: true, permissions: Object.values(PERM) } });
  const customerRole = await db.role.create({ data: { tenantId: retail.id, key: "customer", name: "Customer", isSystem: true, permissions: [PERM.ORDER_READ] } });
  const kelvin = await db.user.create({ data: { tenantId: retail.id, name: "Kelvin Mwangi", email: "admin@kilimaniretail.io", passwordHash: pw } });
  await db.userRole.create({ data: { userId: kelvin.id, roleId: retOwnerRole.id } });
  await db.demoOrder.create({ data: { reference: "ORD-3388", customerPhone: "+254739000020", item: "Wireless Headphones", status: "shipped", eta: "2026-08-15" } });
  const brianCustomer = await db.contact.create({ data: { tenantId: retail.id, channelType: "webchat", address: "+254739000020", displayName: "Brian Njoroge", phoneVerified: true, grants: { orders: [{ id: "ORD-3388", name: "Wireless Headphones" }] } } });
  await db.contactRole.create({ data: { contactId: brianCustomer.id, roleId: customerRole.id } });
  const retConnector = await db.connector.create({
    data: {
      tenantId: retail.id, name: "Kilimani Retail Orders", description: "Order management system.", kind: "rest",
      baseUrl: baseFor("/api/demo-business"), authType: "api_key",
      authConfigEnc: encryptJSON({ type: "api_key", header: "x-api-key", value: process.env.DEMO_BUSINESS_API_KEY || "demo-business-key-kilimani" }),
      timeoutMs: 8000, maxRetries: 1, status: "active",
    },
  });
  await db.connectorAction.create({
    data: {
      connectorId: retConnector.id, key: "GET_ORDER_STATUS", name: "Get order status", operation: "read", method: "GET",
      path: "/orders/{orderRef}",
      paramSchema: [{ name: "orderRef", in: "path", required: true, from: "entity", entity: "orderRef" }],
      responseMapping: { reference: "reference", item: "item", status: "status", eta: "eta" },
      requiredPermission: PERM.ORDER_READ, resourceGrantKey: "orders", resourceParam: "orderRef",
      requiresStepUp: false, samplePhrases: ["where is my order", "order status", "track my order", "my delivery", "has my order shipped", "delivery status", "shipping", "where is my package", "order tracking", "when will it arrive", "my parcel"],
      replyTemplate: "Your order {reference} ({item}) is {status} 📦. Estimated arrival: {eta}.",
    } as never,
  });

  console.log("✓ Seed complete.");
  console.log("\n  Organization numbers (message these):");
  console.log("    +254711562526  Hamzone Technologies  (employee +254739536255 → payslip)");
  console.log("    +254711000001  Riverside Academy      (parent +254700000001 → results/fees)");
  console.log("    +254711000002  Nairobi Hospital       (patient +254739000010 → appointment)");
  console.log("    +254711000003  Kilimani Retail        (customer +254739000020 → order status)");
  console.log("\n  Dashboards (password: password): grace@riverside.ac · zainab@hamzone.io · admin@nairobihospital.io · admin@kilimaniretail.io");
  console.log("  Super admin: admin@p2less.io / password");
  console.log("  Demo: open /  → pick an organization number to message.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
