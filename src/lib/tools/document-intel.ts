import "server-only";
import { complete } from "../ai";
import { registerTool, extOf, type ToolInput, type ToolContext, type ToolResult } from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Document intelligence. Send a PDF or Word doc → we extract the real text
// (pdf-parse / mammoth — no OCR, so an image-only scan won't have text to read;
// we say so honestly rather than guessing) and either answer the user's specific
// question or summarize it. The extracted text is handed back via `remember` so
// a later text-only follow-up ("what does it say about X?") works without the
// user re-sending the file.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHARS_FOR_AI = 12_000; // keep prompt cost/latency sane on long docs
const MAX_CHARS_REMEMBERED = 6_000; // capped so conversation context stays small

async function extractText(base64: string, ext: string): Promise<string | null> {
  const buf = Buffer.from(base64, "base64");
  try {
    if (ext === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buf });
      try {
        const out = await parser.getText();
        return out.text?.trim() || null;
      } finally {
        await parser.destroy();
      }
    }
    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const out = await mammoth.extractRawText({ buffer: buf });
      return out.value?.trim() || null;
    }
  } catch (e) {
    console.error("[document-intel] extractText failed:", e);
    return null;
  }
  return null;
}

async function run(input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
  const att = input.attachment!;
  const ext = extOf(att.filename);

  if (ext === "doc") {
    return { reply: `I can read *.docx* Word files, but not the older *.doc* format 📄 Could you save "${att.filename}" as .docx (or PDF) and resend it?`, noCharge: true };
  }

  const text = await extractText(att.base64, ext);
  if (!text || text.length < 20) {
    return {
      reply: `I opened "${att.filename}" but couldn't find any readable text in it 🤔 If it's a scanned image (a photo of a page rather than a typed document), I can't read that yet — could you send a text-based PDF or Word file instead?`,
      noCharge: true,
    };
  }

  const truncated = text.length > MAX_CHARS_FOR_AI;
  const forAI = text.slice(0, MAX_CHARS_FOR_AI);
  const question = (input.text ?? "").trim();

  const system = `You are a sharp, friendly assistant on ${ctx.assistant}'s WhatsApp, helping someone understand a document they just sent.
- You are given the REAL extracted text of the document. Base your answer ONLY on that text — never invent clauses, numbers, names, or facts that aren't in it.
- If the user asked a specific question, answer it directly and precisely, quoting or closely paraphrasing the relevant part.
- If they didn't ask anything specific, give a clear, useful summary: what kind of document it is, and the 3-5 most important points.
- If the answer genuinely isn't in the document, say so plainly rather than guessing.
- Be concise and WhatsApp-friendly. Reply in the user's language. Do not say you are an AI.`;
  const user = `DOCUMENT TEXT (extracted from "${att.filename}"${truncated ? ", truncated — this is the first part of a longer document" : ""}):\n${forAI}\n\n${question ? `The user asked: ${JSON.stringify(question)}` : "No specific question — give the most useful summary."}`;

  const out = await complete(system, user, 700, 0.3);
  const reply = out ?? `Here's the start of "${att.filename}":\n\n${forAI.slice(0, 500)}${forAI.length > 500 ? "…" : ""}\n\n(Ask me a specific question about it and I'll dig deeper.)`;

  return {
    reply,
    remember: { label: att.filename, text: text.slice(0, MAX_CHARS_REMEMBERED) },
  };
}

registerTool({
  id: "document-intel",
  name: "Document analysis",
  description: "Read a PDF or Word document: summarize it or answer specific questions about it.",
  cost: 3,
  announce: "📄 Give me a moment — reading through your document now...",
  matches: (input) => {
    const att = input.attachment;
    if (!att) return false;
    const ext = extOf(att.filename);
    return ext === "pdf" || ext === "docx" || ext === "doc" || /\bpdf\b|\bword\b|msword|officedocument\.wordprocessingml/i.test(att.mimeType);
  },
  run,
});
