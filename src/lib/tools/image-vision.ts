import "server-only";
import { complete, analyzeImage } from "../ai";
import { registerTool, type ToolInput, type ToolContext, type ToolResult } from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Image vision. Closes the exact gap document-intel.ts's own comment
// names honestly ("if it's a scanned image... I can't read that yet") and the
// dispatcher's own unmatched-attachment fallback used to hand every image —
// "right now I can analyze *spreadsheets*". Reads any WhatsApp photo: text
// visible in it (a document photo, receipt, screenshot, sign) transcribed
// verbatim, plus a plain description of what else is in it. The description
// is handed back via `remember`, same as document-intel's extracted text, so
// a follow-up ("what's the total on that receipt?") works without resending.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHARS_REMEMBERED = 4_000;

async function run(input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
  const att = input.attachment!;
  const caption = (input.text ?? "").trim();

  const description = await analyzeImage(att.base64, att.mimeType, caption || undefined);
  if (!description) {
    return {
      reply: `I can see you sent an image, but I'm having trouble reading it right now 🤔 Could you try again in a moment, or describe what you need in words?`,
      noCharge: true,
    };
  }

  // A caption is a real question/instruction, not just context — answer it
  // directly, grounded in what was actually seen, rather than just repeating
  // the raw description back. No caption → the description itself IS the
  // useful reply, so skip the extra AI round-trip.
  let reply = description;
  if (caption) {
    const system = `You are a sharp, friendly assistant on ${ctx.assistant}'s WhatsApp. Someone sent a photo with a caption. You're given a factual description of what's actually in the photo (including any text it contains, transcribed) — answer their caption using ONLY that description. Never invent details the description doesn't mention. Be concise and WhatsApp-friendly. Reply in the user's language. Do not say you are an AI.`;
    const user = `WHAT'S IN THE PHOTO:\n${description}\n\nThe sender's caption/question: ${JSON.stringify(caption)}`;
    const answered = await complete(system, user, 500, 0.3);
    if (answered) reply = answered;
  }

  return {
    reply,
    remember: { label: "the photo you sent", text: description.slice(0, MAX_CHARS_REMEMBERED) },
  };
}

registerTool({
  id: "image-vision",
  name: "Image reading",
  description: "Read a photo: transcribe any text in it (documents, receipts, screenshots, signs) and describe what it shows.",
  cost: 2,
  announce: "📸 Let me take a look at that...",
  matches: (input) => {
    const att = input.attachment;
    if (!att) return false;
    return /^image\//i.test(att.mimeType);
  },
  run,
});
