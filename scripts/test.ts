/**
 * P2Less test suite — real end-to-end conversations through the channel endpoint,
 * driving the full engine: DESTINATION NUMBER → tenant routing → identity →
 * intent → authorization → OTP → connector → external system → reply. Plus
 * direct DB checks for tenant isolation. Requires the dev server at BASE.
 *
 *   npm run dev   # terminal 1
 *   npm test      # terminal 2
 */
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { matchIntent, isGreeting } from "../src/lib/intent-engine";

const BASE = process.env.P2LESS_BASE_URL || "http://localhost:3000";
const db = new PrismaClient();

// Organization numbers (the front doors) and sender identities.
const HAMZONE = "+254711562526";
const SCHOOL = "+254711000001";
const HOSPITAL = "+254711000002";
const RETAIL = "+254711000003";
const AMIR = "+254739536255"; // Hamzone employee
const AMINA = "+254700000001"; // Riverside parent (John, Mary)
const JOSEPH = "+254700000002"; // Riverside parent (two Brians)
const DAVID = "+254700000009"; // unknown/unlinked
const FAITH = "+254739000010"; // Hospital patient
const CUSTOMER = "+254739000020"; // Retail customer

let passed = 0, failed = 0;
const fails: string[] = [];
function check(name: string, cond: boolean, detail = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(name); console.log(`  ✗ ${name} ${detail ? "→ " + detail : ""}`); }
}

type Reply = { body: string; kind?: string; document?: { url: string; filename: string } };
type Res = { replies: Reply[]; from?: { number: string; name: string } };
async function msg(toNumber: string, fromNumber: string, text: string): Promise<Res> {
  const res = await fetch(`${BASE}/api/channels/webchat`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toNumber, fromNumber, text }),
  });
  const data = (await res.json()) as { replies?: Reply[]; from?: { number: string; name: string } };
  return { replies: data.replies ?? [], from: data.from };
}
const say = async (to: string, from: string, text: string) => (await msg(to, from, text)).replies;
const joined = (rs: Reply[]) => rs.map((r) => r.body).join(" | ");
const otpCode = (rs: Reply[]) => rs.find((r) => r.kind === "otp_hint")?.body.match(/\b(\d{6})\b/)?.[1];
async function clearSession(address: string) {
  const c = await db.contact.findFirst({ where: { address } });
  if (c) await db.authSession.deleteMany({ where: { contactId: c.id } });
}
// Reset OTP session + rate-limit counter so dense test runs don't trip the guard.
async function resetOtp(address: string) {
  const c = await db.contact.findFirst({ where: { address } });
  if (c) {
    await db.authSession.deleteMany({ where: { contactId: c.id } });
    await db.otpChallenge.deleteMany({ where: { contactId: c.id } });
  }
}

async function main() {
  console.log("\nP2Less test suite\n=================\n");
  try { await fetch(`${BASE}/`); } catch { console.error(`Cannot reach ${BASE}. Run: npm run dev`); process.exit(2); }

  // ── Unit: intent matcher ────────────────────────────────────────────────
  console.log("Intent engine (unit)");
  const acts = [
    { id: "a", key: "GET_MY_PAYSLIP", name: "Get my payslip", samplePhrases: ["my payslip", "salary slip", "payslip"] },
    { id: "b", key: "GET_MY_LEAVE_BALANCE", name: "Get my leave balance", samplePhrases: ["leave balance", "leave days"] },
  ];
  check("matches payslip phrasing", matchIntent("send me my payslip", acts).actionKey === "GET_MY_PAYSLIP");
  check("matches leave phrasing", matchIntent("how many leave days do I have", acts).actionKey === "GET_MY_LEAVE_BALANCE");
  check("no match on gibberish", matchIntent("qwerty zxcvb", acts).actionKey === null);
  // Greeting recognition (tolerant of typos), without false positives.
  check("greets 'helloo'", isGreeting("helloo"));
  check("greets 'good morning'", isGreeting("good morning"));
  check("greets 'hii' / 'yo'", isGreeting("hii") && isGreeting("yo"));
  check("'my payslip' is NOT a greeting", !isGreeting("my payslip"));
  // Fuzzy / cut-off word matching.
  check("fuzzy 'payslp' → payslip", matchIntent("my payslp", acts).actionKey === "GET_MY_PAYSLIP");
  check("fuzzy 'leav balance' → leave", matchIntent("leav balance", acts).actionKey === "GET_MY_LEAVE_BALANCE");

  // ── Routing: destination number → correct organization ──────────────────
  console.log("\nRouting — destination number identifies the organization");
  const rHam = await msg(HAMZONE, AMIR, "Hi");
  check("Hamzone number → Hamzone identity", rHam.from?.name === "Hamzone Technologies", JSON.stringify(rHam.from));
  const rSch = await msg(SCHOOL, AMINA, "Hi");
  check("School number → Riverside identity", rSch.from?.name === "Riverside Academy", JSON.stringify(rSch.from));
  const rHos = await msg(HOSPITAL, FAITH, "Hi");
  check("Hospital number → hospital identity", rHos.from?.name === "Nairobi Hospital", JSON.stringify(rHos.from));
  const rRet = await msg(RETAIL, CUSTOMER, "Hi");
  check("Retail number → retail identity", rRet.from?.name === "Kilimani Retail", JSON.stringify(rRet.from));
  const rUnknown = await msg("+254700000999", AMIR, "Hi");
  check("unknown number is not in service", /not in service/i.test(joined(rUnknown.replies)), joined(rUnknown.replies));

  // ── Hamzone payslip (write-sensitive read with OTP step-up) ─────────────
  console.log("\nHamzone — payslip (OTP step-up)");
  await resetOtp(AMIR);
  const p1 = await say(HAMZONE, AMIR, "Send me my payslip");
  check("payslip requires OTP", /6-digit code/i.test(joined(p1)), joined(p1));
  const code = otpCode(p1);
  check("OTP issued", !!code);
  if (code) {
    const p2 = await say(HAMZONE, AMIR, code);
    check("verified → returns payslip (net 138,?000)", /138,?000/.test(joined(p2)), joined(p2));
    check("payslip delivered as a PDF document", p2.some((r) => !!r.document && /\.pdf$/.test(r.document.filename)), joined(p2));
  }

  // ── Hamzone request leave (write, multi-step + confirm + PDF) ────────────
  console.log("\nHamzone — request leave (write + PDF)");
  const l1 = await say(HAMZONE, AMIR, "I want to request leave");
  check("leave request asks for start date", /start/i.test(joined(l1)), joined(l1));
  await say(HAMZONE, AMIR, "20 August");
  const l3 = await say(HAMZONE, AMIR, "23 August");
  check("summarizes leave + asks to confirm", /confirm/i.test(joined(l3)) && /20 august/i.test(joined(l3)), joined(l3));
  const l4 = await say(HAMZONE, AMIR, "CONFIRM");
  check("leave submitted with a reference", /submitted/i.test(joined(l4)) && /LR-/i.test(joined(l4)), joined(l4));
  check("leave confirmation delivered as a PDF", l4.some((r) => !!r.document && /\.pdf$/.test(r.document.filename)), joined(l4));
  const leave = await say(HAMZONE, AMIR, "What is my leave balance?");
  check("leave balance returns 18 days (no OTP)", /18/.test(joined(leave)), joined(leave));

  // ── Numbered menu: reply with a number to pick a capability ─────────────
  console.log("\nMenu — reply with a number");
  const m1 = await say(HAMZONE, AMIR, "menu");
  const menuText = joined(m1);
  check("greeting shows a numbered menu", /\n1\.\s/.test(menuText) && /\n2\.\s/.test(menuText) && /Get my payslip/i.test(menuText), menuText);
  const leaveNum = menuText.match(/(\d+)\.\s*Get my leave balance/i)?.[1];
  check("menu lists the leave-balance capability", !!leaveNum, menuText);
  const m2 = leaveNum ? await say(HAMZONE, AMIR, leaveNum) : [];
  check("replying with the menu number runs that capability", /leave remaining/i.test(joined(m2)), joined(m2));

  // Broader phrasing still resolves (synonyms).
  const syn = await say(HAMZONE, AMIR, "how many days off do I have left");
  check("synonym phrasing ('days off') resolves to leave", /leave remaining/i.test(joined(syn)), joined(syn));

  // ── Conversation flow — pending states are forgiving, never stuck ────────
  console.log("\nFlow — forgiving pending states");
  await resetOtp(AMIR);
  const f1 = await say(HAMZONE, AMIR, "send me my payslip");
  check("payslip → OTP prompt", /6-digit code/i.test(joined(f1)), joined(f1));
  const f2 = await say(HAMZONE, AMIR, "Hello");
  check("greeting during OTP → greets, not 'incorrect'", /welcome back|reply with a number/i.test(joined(f2)) && !/incorrect/i.test(joined(f2)), joined(f2));
  const f3 = await say(HAMZONE, AMIR, "What is my leave balance");
  check("new request during OTP → answered, not stuck", /leave remaining/i.test(joined(f3)), joined(f3));
  await say(HAMZONE, AMIR, "send me my payslip"); // re-trigger OTP
  const f5 = await say(HAMZONE, AMIR, "where is the code");
  check("'where is the code' → resends, not 'incorrect'", /fresh code|6-digit code/i.test(joined(f5)) && !/incorrect/i.test(joined(f5)), joined(f5));
  const fcode = otpCode(f5);
  const f6 = fcode ? await say(HAMZONE, AMIR, fcode) : [];
  check("fresh code then verifies + returns payslip", /138,?000/.test(joined(f6)), joined(f6));

  // ── TENANT ISOLATION across numbers ─────────────────────────────────────
  console.log("\nTenant isolation — the same person, different org numbers");
  // Amir messaging the SCHOOL number cannot get his Hamzone payslip there.
  const cross1 = await say(SCHOOL, AMIR, "Send me my payslip");
  check("payslip capability absent at the school number", !/138,?000|payslip for/i.test(joined(cross1)), joined(cross1));
  // Amir asking the Hamzone number for school data — no such capability.
  const cross2 = await say(HAMZONE, AMIR, "Show me John's exam results");
  check("school capability absent at the Hamzone number", !/mathematics|average/i.test(joined(cross2)), joined(cross2));
  // Unknown sender to Hamzone asking payslip → onboarded, never handed data.
  const hamT0 = await db.tenant.findUnique({ where: { slug: "hamzone" } });
  if (hamT0) await db.contact.deleteMany({ where: { tenantId: hamT0.id, address: { in: [DAVID, "+254799111222", "+254788000111"] } } });
  const cross3 = await say(HAMZONE, DAVID, "Send me my payslip");
  check("unknown sender is onboarded, not handed data", !/138,?000|payslip for/i.test(joined(cross3)) && /employee id/i.test(joined(cross3)), joined(cross3));

  // ── Onboarding: unknown user self-links via their Employee ID ────────────
  console.log("\nOnboarding — unknown user self-links");
  const NEWEMP = "+254799111222"; // on file for EMP-190 (Grace)
  const BADNUM = "+254788000111"; // not on file for anyone
  const o1 = await say(HAMZONE, NEWEMP, "Hi");
  check("warm welcome + asks for Employee ID (no data)", /employee id/i.test(joined(o1)) && !/138,?000/.test(joined(o1)), joined(o1));
  const o2 = await say(HAMZONE, NEWEMP, "EMP-190");
  check("correct ID triggers OTP step-up before linking", /6-digit code/i.test(joined(o2)), joined(o2));
  const ocode = otpCode(o2);
  check("link OTP issued", !!ocode);
  const o2b = ocode ? await say(HAMZONE, NEWEMP, ocode) : [];
  check("OTP verified → account linked", /verified|linked/i.test(joined(o2b)), joined(o2b));
  const o3 = await say(HAMZONE, NEWEMP, "What is my leave balance?");
  check("now recognized → returns their OWN data (12 days)", /\b12\b/.test(joined(o3)), joined(o3));
  await say(HAMZONE, BADNUM, "Hi");
  const n2 = await say(HAMZONE, BADNUM, "EMP-184"); // Amir's ID, but not this phone
  check("ID that doesn't match the phone is rejected", /couldn't match/i.test(joined(n2)) && !/138,?000/.test(joined(n2)), joined(n2));

  // ── School still works (results with OTP, balance, memory, ambiguity) ───
  console.log("\nRiverside — reads, OTP, memory, ambiguity");
  const bal = await say(SCHOOL, AMINA, "What is John's fee balance?");
  check("school balance returns 18500", /18,500/.test(joined(bal)), joined(bal));
  const notMine = await say(SCHOOL, AMINA, "What is Brian's fee balance?");
  check("cross-parent isolation (Amina ≠ Brian)", /couldn't find|not authorized|no student/i.test(joined(notMine)), joined(notMine));
  const ambiguous = await say(SCHOOL, JOSEPH, "What is Brian's fee balance?");
  check("ambiguity → asks which Brian", /more than one|which/i.test(joined(ambiguous)) && /1\.|2\./.test(joined(ambiguous)), joined(ambiguous));
  await resetOtp(AMINA);
  const res1 = await say(SCHOOL, AMINA, "Show me John's results.");
  check("school results require OTP", /6-digit code/i.test(joined(res1)), joined(res1));
  const rcode = otpCode(res1);
  if (rcode) {
    const res2 = await say(SCHOOL, AMINA, rcode);
    check("verified → results + document", /average/i.test(joined(res2)) && res2.some((r) => r.kind === "document"), joined(res2));
  }
  await say(SCHOOL, AMINA, "What is John's fee balance?");
  const his = await say(SCHOOL, AMINA, "what about his attendance?");
  check("memory resolves 'his' → John", /john/i.test(joined(his)) && /%|attendance/.test(joined(his)), joined(his));

  // ── School write: booking (multi-step + confirm) ────────────────────────
  console.log("\nRiverside — booking (write, multi-step + confirm)");
  const b1 = await say(SCHOOL, AMINA, "Book a meeting for John");
  check("asks date", /date/i.test(joined(b1)), joined(b1));
  await say(SCHOOL, AMINA, "Tuesday");
  const b3 = await say(SCHOOL, AMINA, "10 AM");
  check("summarizes + confirms", /confirm/i.test(joined(b3)), joined(b3));
  const b4 = await say(SCHOOL, AMINA, "CONFIRM");
  check("write executes + reference", /booked/i.test(joined(b4)) && /APT-/i.test(joined(b4)), joined(b4));

  // ── Conversational CRUD: Update (reschedule) + Delete (cancel) ───────────
  console.log("\nRiverside — conversational CRUD (update + delete)");
  const john = await db.demoStudent.findFirst({ where: { externalId: "STU-001" } });
  if (john) {
    await db.demoAppointment.deleteMany({ where: { studentId: john.id } });
    await db.demoAppointment.create({ data: { reference: "APT-CRUD", studentId: john.id, date: "2026-08-18", time: "10:30 AM", reason: "Review", status: "confirmed" } });
  }
  const u1 = await say(SCHOOL, AMINA, "reschedule John's appointment");
  check("UPDATE: reschedule asks for a new date (not book)", /date/i.test(joined(u1)) && !/time/i.test(joined(u1)), joined(u1));
  await say(SCHOOL, AMINA, "next Friday");
  const u3 = await say(SCHOOL, AMINA, "CONFIRM");
  check("UPDATE: appointment rescheduled", /rescheduled/i.test(joined(u3)), joined(u3));
  const d1 = await say(SCHOOL, AMINA, "cancel John's appointment");
  check("DELETE: cancel asks to confirm", /confirm/i.test(joined(d1)), joined(d1));
  const d2 = await say(SCHOOL, AMINA, "CONFIRM");
  check("DELETE: appointment cancelled", /cancelled/i.test(joined(d2)), joined(d2));

  // ── Hospital + Retail ───────────────────────────────────────────────────
  console.log("\nHospital + Retail — other industries, same platform");
  const appt = await say(HOSPITAL, FAITH, "When is my next appointment?");
  check("hospital returns the appointment", /2026-08-20|dental/i.test(joined(appt)), joined(appt));
  const order = await say(RETAIL, CUSTOMER, "Where is my order?");
  check("retail returns the order status", /shipped|ORD-3388/i.test(joined(order)), joined(order));

  // ── Resilience: external system down → honest failure + recovery ────────
  console.log("\nResilience — external system down");
  const conn = await db.connector.findFirst({ where: { tenant: { slug: "hamzone" } } });
  if (conn) {
    const good = conn.baseUrl;
    await db.connector.update({ where: { id: conn.id }, data: { baseUrl: "http://127.0.0.1:59999/nope" } });
    const down = await say(HAMZONE, AMIR, "What is my leave balance?");
    check("honest failure when payroll is down", /unavailable|try again/i.test(joined(down)), joined(down));
    await db.connector.update({ where: { id: conn.id }, data: { baseUrl: good } });
    const rec = await say(HAMZONE, AMIR, "What is my leave balance?");
    check("recovers when payroll is back", /18/.test(joined(rec)), joined(rec));
  }

  // ── Developer API + webhooks ────────────────────────────────────────────
  console.log("\nDeveloper API + webhooks");
  const API_KEY = "p2l_demo_hamzone_readonly_key";
  check("API rejects missing key (401)", (await fetch(`${BASE}/api/v1/numbers`)).status === 401);
  check("API rejects bad key (401)", (await fetch(`${BASE}/api/v1/numbers`, { headers: { Authorization: "Bearer p2l_wrong" } })).status === 401);
  const numsRes = await fetch(`${BASE}/api/v1/numbers`, { headers: { Authorization: `Bearer ${API_KEY}` } });
  const numsJson = (await numsRes.json()) as { data?: { phoneNumber: string }[] };
  check("API key returns tenant numbers", numsRes.status === 200 && !!numsJson.data?.some((n) => n.phoneNumber === "+254711562526"), JSON.stringify(numsJson).slice(0, 120));
  const capsJson = (await (await fetch(`${BASE}/api/v1/capabilities`, { headers: { Authorization: `Bearer ${API_KEY}` } })).json()) as unknown;
  check("API lists capabilities", JSON.stringify(capsJson).includes("GET_MY_PAYSLIP"));

  // Write endpoints
  const sendRes = await fetch(`${BASE}/api/v1/messages`, { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: "+254711562526", to: "+254700999888", text: "API test" }) });
  const sendJson = (await sendRes.json()) as { conversationId?: string };
  check("POST /messages creates a conversation", [201, 202].includes(sendRes.status) && !!sendJson.conversationId, `${sendRes.status} ${JSON.stringify(sendJson)}`);
  check("POST /messages needs auth (401)", (await fetch(`${BASE}/api/v1/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status === 401);
  const whRes = await fetch(`${BASE}/api/v1/webhooks`, { method: "POST", headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: "https://example.com/hook", events: ["payment.paid"] }) });
  const whJson = (await whRes.json()) as { id?: string; secret?: string };
  check("POST /webhooks creates + returns a secret", whRes.status === 201 && !!whJson.id && !!whJson.secret, JSON.stringify(whJson));
  if (whJson.id) {
    const delRes = await fetch(`${BASE}/api/v1/webhooks/${whJson.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${API_KEY}` } });
    check("DELETE /webhooks/{id} removes it", delRes.status === 200);
  }

  const hamW = await db.tenant.findUnique({ where: { slug: "hamzone" } });
  if (hamW) {
    const sinkUrl = `${BASE}/api/webhook-sink-test`;
    await db.webhook.deleteMany({ where: { tenantId: hamW.id, url: sinkUrl } });
    const secret = "whsec_testsecret123";
    await db.webhook.create({ data: { tenantId: hamW.id, url: sinkUrl, secret, events: ["message.received"], active: true } });
    await say(HAMZONE, AMIR, "webhook delivery probe");
    await new Promise((r) => setTimeout(r, 1500)); // allow fire-and-forget delivery
    const sink = (await (await fetch(sinkUrl)).json()) as { deliveries?: { event: string | null; signature: string | null; body: string }[] };
    const del = sink.deliveries?.find((d) => d.event === "message.received" && d.body.includes("webhook delivery probe"));
    check("webhook 'message.received' is delivered", !!del, JSON.stringify(sink).slice(0, 120));
    if (del) {
      const expected = "sha256=" + crypto.createHmac("sha256", secret).update(del.body).digest("hex");
      check("webhook signature is a valid HMAC", del.signature === expected);
    }
    await db.webhook.deleteMany({ where: { tenantId: hamW.id, url: sinkUrl } });
  }

  // ── Multi-tenancy at the data layer ─────────────────────────────────────
  console.log("\nMulti-tenancy — data-layer isolation");
  const hamTenant = await db.tenant.findUnique({ where: { slug: "hamzone" } });
  const schoolTenant = await db.tenant.findUnique({ where: { slug: "riverside" } });
  if (hamTenant && schoolTenant) {
    const hamContacts = await db.contact.count({ where: { tenantId: hamTenant.id } });
    const leak = await db.contact.count({ where: { tenantId: hamTenant.id, address: AMINA } });
    check("each tenant has its own contacts", hamContacts > 0);
    check("a school parent is not a Hamzone contact", leak === 0);
  }
  const numbers = await db.whatsAppNumber.findMany();
  check("every number maps to exactly one tenant", numbers.every((n) => !!n.tenantId) && new Set(numbers.map((n) => n.phoneNumber)).size === numbers.length);

  // ── Governance: audit + secret hygiene ──────────────────────────────────
  console.log("\nGovernance — audit trail");
  const execs = await db.auditLog.count({ where: { action: "connector.execute", success: true } });
  const denied = await db.auditLog.count({ where: { action: "otp.verify", success: false } });
  check("successful connector executions audited", execs > 0);
  const allLogs = await db.auditLog.findMany({ take: 800, orderBy: { createdAt: "desc" } });
  const anySecret = allLogs.some((l) => /demo-(payroll|school|hospital|business)-key|api-key-riverside/.test(JSON.stringify(l.detail ?? {})));
  check("credentials never appear in audit detail", !anySecret);
  void denied;

  console.log(`\n=================`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) console.log(`Failed: ${fails.join(", ")}`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
