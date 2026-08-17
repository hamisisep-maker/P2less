import "server-only";
import { complete } from "../ai";
import { registerTool, decodeText, extOf, type ToolInput, type ToolContext, type ToolResult } from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Data analysis. Send a CSV → we profile it deterministically (columns,
// types, row count, numeric stats, a sample) and hand that compact profile to the
// AI to explain trends and answer the user's question. The NUMBERS come from real
// computation, not the model, so figures are exact; the AI only interprets.
// ─────────────────────────────────────────────────────────────────────────────

const DATA_EXTS = ["csv", "tsv", "txt"];
const EXCEL_EXTS = ["xls", "xlsx"];

/** Minimal RFC-4180-ish CSV/TSV parser (handles quoted fields + escaped quotes). */
function parseDelimited(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); field = ""; row = [];
    } else if (c === "\r") {
      /* skip */
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const isNum = (v: string) => v.trim() !== "" && !isNaN(Number(v.replace(/[, ]/g, "")));
const toNum = (v: string) => Number(v.replace(/[, ]/g, ""));

/** Build a compact, factual profile of the table for the model to interpret. */
function profile(rows: string[][]): { summary: string; sample: string } | null {
  if (rows.length < 2) return null;
  const headers = rows[0].map((h, i) => h.trim() || `col${i + 1}`);
  const data = rows.slice(1);
  const nRows = data.length;

  const cols = headers.map((name, i) => {
    const values = data.map((r) => (r[i] ?? "").trim()).filter((v) => v !== "");
    const nums = values.filter(isNum).map(toNum);
    const numeric = values.length > 0 && nums.length >= values.length * 0.8;
    if (numeric && nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      return `- ${name} (number): min ${fmt(Math.min(...nums))}, max ${fmt(Math.max(...nums))}, mean ${fmt(mean)}, sum ${fmt(sum)}`;
    }
    const uniq = new Set(values);
    const top = [...uniq].slice(0, 4).join(", ");
    return `- ${name} (text): ${uniq.size} distinct${uniq.size <= 12 ? ` (e.g. ${top})` : ""}`;
  });

  const sampleRows = [headers.join(" | "), ...data.slice(0, 12).map((r) => headers.map((_, i) => (r[i] ?? "").trim()).join(" | "))];
  return {
    summary: `Rows: ${nRows}. Columns: ${headers.length}.\n${cols.join("\n")}`,
    sample: sampleRows.join("\n"),
  };
}

function fmt(n: number): string {
  if (!isFinite(n)) return String(n);
  const r = Math.round(n * 100) / 100;
  return Math.abs(r) >= 1000 ? r.toLocaleString("en-US") : String(r);
}

async function run(input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
  const att = input.attachment!;
  const ext = extOf(att.filename);

  if (EXCEL_EXTS.includes(ext)) {
    return { reply: `I can read *CSV* files right now 📊 To analyze "${att.filename}", open it in Excel → *File → Save As → CSV*, then send that. (Full Excel support is coming.)`, noCharge: true };
  }

  let text: string;
  try {
    text = decodeText(att);
  } catch {
    return { reply: "I couldn't read that file — could you resend it as a CSV?", noCharge: true };
  }
  const delimiter = ext === "tsv" || (text.includes("\t") && !text.includes(",")) ? "\t" : ",";
  const rows = parseDelimited(text, delimiter);
  const prof = profile(rows);
  if (!prof) {
    return { reply: "That file doesn't look like a table I can analyze. Send a CSV with a header row and some data and I'll break it down. 📊", noCharge: true };
  }

  const question = (input.text ?? "").trim();
  const system = `You are a sharp, friendly data analyst replying on ${ctx.assistant}'s WhatsApp. You are given a FACTUAL PROFILE of a spreadsheet (computed exactly from the data) and a SAMPLE of its rows.
- Give a clear, useful read of the data: the headline, 2–4 concrete insights (trends, outliers, totals), and — if the user asked a question — answer it directly.
- Use ONLY the numbers in the profile/sample; do not invent figures. If something can't be known from what's given, say so briefly.
- Be concise and WhatsApp-friendly: short paragraphs or a few bullet points, a tasteful emoji is fine. Reply in the user's language.
- Do not say you are an AI.`;
  const user = `DATA PROFILE (exact):\n${prof.summary}\n\nSAMPLE ROWS:\n${prof.sample}\n\n${question ? `The user asked: ${JSON.stringify(question)}` : "The user sent this file with no specific question — give them the most useful overview."}`;

  const out = await complete(system, user, 700, 0.3);
  if (!out) {
    // AI unavailable → still return the deterministic profile so it's never useless.
    return { reply: `Here's what I can see in *${att.filename}*:\n\n${prof.summary}\n\n(Send me a question about it and I'll dig deeper.)` };
  }
  return { reply: out };
}

registerTool({
  id: "data-analysis",
  name: "Data analysis",
  description: "Analyze a CSV/spreadsheet: trends, totals, insights, and answers to your questions.",
  cost: 2,
  matches: (input) => {
    const att = input.attachment;
    if (!att) return false;
    const ext = extOf(att.filename);
    return DATA_EXTS.includes(ext) || EXCEL_EXTS.includes(ext) || /csv|excel|spreadsheet|tab-separated/i.test(att.mimeType);
  },
  run,
});
