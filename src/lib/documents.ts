import "server-only";
import PDFDocument from "pdfkit";
import { db } from "./db";
import { randomToken } from "./crypto";
import { meter } from "./usage";

// ─────────────────────────────────────────────────────────────────────────────
// Document generation + secure temporary delivery. For the MVP a document is a
// self-contained HTML page stored inline and reachable via an unguessable token
// URL that expires. In production this renders to PDF and stores in object
// storage with signed, expiring URLs. Branding is pulled from the tenant.
// ─────────────────────────────────────────────────────────────────────────────

const DOC_TTL_MS = 30 * 60 * 1000; // 30 minutes

type Branding = { assistantName?: string; primaryColor?: string; pdfFooter?: string };

export type GeneratedDoc = { url: string; filename: string; token: string };

/** Render a pdfkit document to a Buffer. */
function renderPdf(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

/** Store bytes as an expiring, token-addressed Document. The URL is absolute
 *  (PUBLIC_BASE_URL) so WhatsApp can fetch it; falls back to relative for local. */
async function store(opts: {
  tenantId: string; contactId?: string; kind: string; filename: string; base64: string;
}): Promise<GeneratedDoc> {
  const token = randomToken();
  await db.document.create({
    data: {
      tenantId: opts.tenantId, contactId: opts.contactId ?? null, kind: opts.kind,
      filename: opts.filename, content: opts.base64, token,
      expiresAt: new Date(Date.now() + DOC_TTL_MS),
    },
  });
  await meter(opts.tenantId, "document");
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { url: `${base}/d/${token}`, filename: opts.filename, token };
}

// Product photos and payment receipts are permanent records, not
// per-conversation generated documents that should vanish in 30 minutes —
// both reuse this long-TTL storage (the Document model requires a non-null
// expiresAt, so "permanent" is expressed as a ~50-year one) with no usage
// metering (neither is a billable generated-document action).
const LONG_TTL_MS = 50 * 365 * 24 * 60 * 60 * 1000;

async function storeLongLived(opts: { tenantId: string; kind: string; filename: string; base64: string }): Promise<GeneratedDoc> {
  const token = randomToken();
  await db.document.create({
    data: {
      tenantId: opts.tenantId, kind: opts.kind,
      filename: opts.filename, content: opts.base64, token,
      expiresAt: new Date(Date.now() + LONG_TTL_MS),
    },
  });
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { url: `${base}/d/${token}`, filename: opts.filename, token };
}

export async function storeProductImage(opts: { tenantId: string; filename: string; base64: string }): Promise<GeneratedDoc> {
  return storeLongLived({ ...opts, kind: "product_image" });
}

/** A synthesized voice-note reply — the official (Meta) WhatsApp transport
 *  sends audio by link (same as document.ts's own PDF delivery, see store()
 *  above), never by uploading raw bytes, so a voice reply needs this same
 *  short-TTL token URL. The unofficial (Baileys) transport sends the raw
 *  buffer directly and never touches this — this function exists only for
 *  the official transport's link-based send. Deliberately does NOT call
 *  store()'s meter(tenantId, "document") — a voice reply isn't a billable
 *  generated document (no price_document_kes charge makes sense for it);
 *  the real cost is already tracked where it actually happens, via
 *  synthesizeSpeech()'s own recordAiCost() call. Double-metering it here
 *  would charge the tenant twice for one reply. */
export async function storeVoiceReply(opts: { tenantId: string; contactId?: string; base64Ogg: string }): Promise<GeneratedDoc> {
  const token = randomToken();
  await db.document.create({
    data: {
      tenantId: opts.tenantId, contactId: opts.contactId ?? null, kind: "voice_reply",
      filename: "reply.ogg", content: opts.base64Ogg, token,
      expiresAt: new Date(Date.now() + DOC_TTL_MS),
    },
  });
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { url: `${base}/d/${token}`, filename: "reply.ogg", token };
}

/** A support-ticket attachment (screenshot, receipt photo, ...) — reuses the
 *  Document model exactly like storeProductImage, not a new file-storage
 *  system, plus a ticketId pointer so it shows up on the ticket it belongs
 *  to. Permanent for as long as the ticket exists (long-TTL, not the default
 *  30-minute generated-document window). */
export async function storeTicketAttachment(opts: { tenantId: string; ticketId: string; filename: string; base64: string }): Promise<GeneratedDoc> {
  const token = randomToken();
  await db.document.create({
    data: {
      tenantId: opts.tenantId, ticketId: opts.ticketId, kind: "ticket_attachment",
      filename: opts.filename, content: opts.base64, token,
      expiresAt: new Date(Date.now() + LONG_TTL_MS),
    },
  });
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return { url: `${base}/d/${token}`, filename: opts.filename, token };
}

/** A payment receipt — a permanent financial record, not a 30-minute
 *  generated-and-forgotten document, so it reuses the long-TTL storage
 *  pattern from storeProductImage() rather than the default DOC_TTL_MS.
 *  Generated the moment a subscription payment is confirmed (see
 *  billing-lifecycle.ts) — retrievable later for any payment dispute. */
export async function generateReceiptPdf(opts: {
  tenantId: string; org: string; color?: string;
  reference: string; amount: number; currency: string; method: string; paidAt: Date; periodLabel?: string; planName?: string;
}): Promise<GeneratedDoc> {
  const color = opts.color ?? "#0d9488";
  const money = (n: number) => `${opts.currency} ${n.toLocaleString("en-US")}`;
  const pdf = await renderPdf((doc) => {
    pdfHeader(doc, opts.org, "Payment Receipt", color);
    doc.fontSize(14).font("Helvetica-Bold").fill("#0f172a").text(`Receipt ${opts.reference}`);
    doc.fontSize(11).font("Helvetica").fill("#475569").text(`Paid ${opts.paidAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`);
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    if (opts.planName) row(doc, "Plan", opts.planName);
    if (opts.periodLabel) row(doc, "Billing period", opts.periodLabel);
    row(doc, "Payment method", opts.method.toUpperCase());
    row(doc, "Reference", opts.reference);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "Amount paid", money(opts.amount), true);
    pdfFooter(doc, `${opts.org} · Official payment receipt · Generated by P2Less`);
  });
  return storeLongLived({ tenantId: opts.tenantId, kind: "receipt", filename: `receipt-${opts.reference}.pdf`, base64: pdf.toString("base64") });
}

// Shared PDF chrome: branded header band + footer.
function pdfHeader(doc: PDFKit.PDFDocument, org: string, title: string, color: string) {
  doc.rect(0, 0, doc.page.width, 90).fill(color);
  doc.fill("#ffffff").fontSize(20).font("Helvetica-Bold").text(org, 50, 30);
  doc.fontSize(12).font("Helvetica").text(title, 50, 58);
  doc.fill("#0f172a").moveDown(3);
  doc.y = 120;
}
function pdfFooter(doc: PDFKit.PDFDocument, note: string) {
  doc.fontSize(9).fill("#94a3b8").font("Helvetica")
    .text(note, 50, doc.page.height - 70, { width: doc.page.width - 100, align: "center" });
}
function row(doc: PDFKit.PDFDocument, label: string, value: string, bold = false) {
  const y = doc.y;
  doc.fontSize(12).fill("#475569").font("Helvetica").text(label, 50, y);
  doc.fill("#0f172a").font(bold ? "Helvetica-Bold" : "Helvetica").text(value, 300, y, { width: 245, align: "right" });
  doc.moveDown(0.8);
}

/** Payslip PDF with the full deductions breakdown. */
export async function generatePayslipPdf(opts: {
  tenantId: string; contactId?: string; org: string; color?: string; footer?: string;
  name: string; title?: string; period: string; currency: string; gross: number; deductions: number; net: number;
}): Promise<GeneratedDoc> {
  const color = opts.color ?? "#4f46e5";
  const money = (n: number) => `${opts.currency} ${n.toLocaleString("en-US")}`;
  const pdf = await renderPdf((doc) => {
    pdfHeader(doc, opts.org, "Payslip", color);
    doc.fontSize(14).font("Helvetica-Bold").fill("#0f172a").text(opts.name);
    doc.fontSize(11).font("Helvetica").fill("#475569").text(`${opts.title ?? "Employee"} · Pay period ${opts.period}`);
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "Gross pay", money(opts.gross));
    row(doc, "Total deductions", `- ${money(opts.deductions)}`);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "Net pay", money(opts.net), true);
    pdfFooter(doc, opts.footer ?? `${opts.org} · Confidential payslip · Generated by P2Less`);
  });
  return store({ tenantId: opts.tenantId, contactId: opts.contactId, kind: "payslip", filename: `payslip-${opts.period}.pdf`, base64: pdf.toString("base64") });
}

/** Fee statement PDF — billed / paid / balance for a student. */
export async function generateFeeStatementPdf(opts: {
  tenantId: string; contactId?: string; org: string; color?: string; footer?: string;
  studentName: string; grade?: string; currency: string; billed: number; paid: number; balance: number; dueDate: string;
}): Promise<GeneratedDoc> {
  const color = opts.color ?? "#0f766e";
  const money = (n: number) => `${opts.currency} ${n.toLocaleString("en-US")}`;
  const pdf = await renderPdf((doc) => {
    pdfHeader(doc, opts.org, "Fee Statement", color);
    doc.fontSize(14).font("Helvetica-Bold").fill("#0f172a").text(opts.studentName);
    doc.fontSize(11).font("Helvetica").fill("#475569").text(`${opts.grade ?? "Student"} · Statement date ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "Total billed", money(opts.billed));
    row(doc, "Paid to date", `- ${money(opts.paid)}`);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "Balance due", money(opts.balance), true);
    row(doc, "Due date", opts.dueDate);
    pdfFooter(doc, opts.footer ?? `${opts.org} · Official fee statement · Generated by P2Less`);
  });
  return store({ tenantId: opts.tenantId, contactId: opts.contactId, kind: "fee_statement", filename: `fee-statement-${slug(opts.studentName)}.pdf`, base64: pdf.toString("base64") });
}

/** Leave-request confirmation PDF. */
export async function generateLeavePdf(opts: {
  tenantId: string; contactId?: string; org: string; color?: string; footer?: string;
  name: string; reference: string; startDate: string; endDate: string; reason?: string; status: string;
}): Promise<GeneratedDoc> {
  const color = opts.color ?? "#4f46e5";
  const pdf = await renderPdf((doc) => {
    pdfHeader(doc, opts.org, "Leave Request", color);
    doc.fontSize(14).font("Helvetica-Bold").fill("#0f172a").text(opts.name);
    doc.fontSize(11).font("Helvetica").fill("#475569").text(`Reference ${opts.reference}`);
    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor("#e2e8f0").stroke();
    doc.moveDown(1);
    row(doc, "From", opts.startDate);
    row(doc, "To", opts.endDate);
    if (opts.reason) row(doc, "Reason", opts.reason);
    row(doc, "Status", opts.status.toUpperCase(), true);
    pdfFooter(doc, opts.footer ?? `${opts.org} · Leave request receipt · Generated by P2Less`);
  });
  return store({ tenantId: opts.tenantId, contactId: opts.contactId, kind: "leave", filename: `leave-${opts.reference}.pdf`, base64: pdf.toString("base64") });
}

export async function generateReportCard(opts: {
  tenantId: string;
  contactId: string;
  studentName: string;
  grade: string;
  results: { subject: string; score: number; grade: string }[];
  branding?: Branding;
}): Promise<{ url: string; filename: string; token: string }> {
  const color = opts.branding?.primaryColor ?? "#0f766e";
  const footer = opts.branding?.pdfFooter ?? "Generated by P2Less";
  const rows = opts.results
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.subject)}</td><td style="text-align:right">${r.score}</td><td style="text-align:center">${escapeHtml(r.grade)}</td></tr>`,
    )
    .join("");
  const avg = opts.results.length
    ? Math.round(opts.results.reduce((s, r) => s + r.score, 0) / opts.results.length)
    : 0;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Report Card — ${escapeHtml(opts.studentName)}</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;color:#0f172a;background:#f8fafc}
  .sheet{max-width:640px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
  .hd{background:${color};color:#fff;padding:20px 24px}
  .hd h1{margin:0;font-size:20px}.hd p{margin:4px 0 0;opacity:.85;font-size:13px}
  .bd{padding:24px}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{padding:10px;border-bottom:1px solid #e2e8f0}
  th{text-align:left;color:#64748b;font-weight:600}
  .avg{margin-top:16px;font-size:15px;font-weight:600}
  .ft{padding:14px 24px;color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0}
</style></head><body>
<div class="sheet">
  <div class="hd"><h1>Report Card</h1><p>${escapeHtml(opts.studentName)} · ${escapeHtml(opts.grade)}</p></div>
  <div class="bd">
    <table><thead><tr><th>Subject</th><th style="text-align:right">Score</th><th style="text-align:center">Grade</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <div class="avg">Overall average: ${avg}%</div>
  </div>
  <div class="ft">${escapeHtml(footer)} · This link is confidential and expires in 30 minutes.</div>
</div></body></html>`;

  const token = randomToken();
  const filename = `report-card-${slug(opts.studentName)}.html`;
  await db.document.create({
    data: {
      tenantId: opts.tenantId,
      contactId: opts.contactId,
      kind: "report_card",
      filename,
      content: html,
      token,
      expiresAt: new Date(Date.now() + DOC_TTL_MS),
    },
  });
  await meter(opts.tenantId, "document");
  return { url: `/d/${token}`, filename, token };
}

export type CvData = {
  name: string;
  contact: string; // phone / email / location, one line
  title?: string; // professional headline, e.g. "Software Engineer"
  summary?: string;
  experience: { role: string; company: string; dates: string; bullets: string[] }[];
  education: { qualification: string; institution: string; dates: string }[];
  skills: string[];
};

/** A clean, professional CV/resume PDF. Deliberately NOT branded as a P2Less
 *  document — this is the person's own document, not an organizational receipt. */
export async function generateCvPdf(opts: { tenantId: string; contactId?: string; data: CvData; accent?: string }): Promise<GeneratedDoc> {
  const accent = opts.accent ?? "#0f766e";
  const d = opts.data;
  const pdf = await renderPdf((doc) => {
    doc.fontSize(24).font("Helvetica-Bold").fill("#0f172a").text(d.name);
    if (d.title) { doc.moveDown(0.15); doc.fontSize(13).font("Helvetica").fill(accent).text(d.title); }
    if (d.contact) { doc.moveDown(0.2); doc.fontSize(10).font("Helvetica").fill("#64748b").text(d.contact); }
    doc.moveDown(0.7);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(accent).lineWidth(2).stroke();
    doc.moveDown(1);

    const section = (title: string) => {
      doc.fontSize(11.5).font("Helvetica-Bold").fill(accent).text(title.toUpperCase());
      doc.moveDown(0.35);
    };

    if (d.summary) {
      section("Summary");
      doc.fontSize(10.5).font("Helvetica").fill("#334155").text(d.summary);
      doc.moveDown(1);
    }

    if (d.experience.length) {
      section("Experience");
      for (const e of d.experience) {
        const y = doc.y;
        doc.fontSize(11).font("Helvetica-Bold").fill("#0f172a").text(`${e.role} — ${e.company}`, 50, y, { width: 375 });
        doc.fontSize(9.5).font("Helvetica").fill("#64748b").text(e.dates, 425, y, { width: 120, align: "right" });
        doc.y = Math.max(doc.y, y + 14);
        for (const b of e.bullets) doc.fontSize(10).font("Helvetica").fill("#334155").text(`•  ${b}`, 60, doc.y);
        doc.moveDown(0.6);
      }
    }

    if (d.education.length) {
      section("Education");
      for (const e of d.education) {
        const y = doc.y;
        doc.fontSize(11).font("Helvetica-Bold").fill("#0f172a").text(`${e.qualification} — ${e.institution}`, 50, y, { width: 375 });
        doc.fontSize(9.5).font("Helvetica").fill("#64748b").text(e.dates, 425, y, { width: 120, align: "right" });
        doc.moveDown(0.5);
      }
    }

    if (d.skills.length) {
      section("Skills");
      doc.fontSize(10.5).font("Helvetica").fill("#334155").text(d.skills.join("   ·   "));
    }

    doc.fontSize(8).fill("#cbd5e1").font("Helvetica").text("Generated by P2Less", 50, doc.page.height - 40, { width: doc.page.width - 100, align: "center" });
  });
  return store({ tenantId: opts.tenantId, contactId: opts.contactId, kind: "cv", filename: `CV-${slug(d.name)}.pdf`, base64: pdf.toString("base64") });
}

export async function getDocumentByToken(token: string) {
  const doc = await db.document.findUnique({ where: { token } });
  if (!doc) return null;
  if (doc.expiresAt < new Date()) return { expired: true as const };
  return { expired: false as const, doc };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
