import "server-only";
import { complete, analyzeVideo } from "../ai";
import { registerTool, type ToolInput, type ToolContext, type ToolResult } from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// TOOL: Video understanding. Same shape as image-vision.ts, extended to
// something that unfolds over time — a customer's video of a defective
// product, a walkthrough, a screen recording. Reads any WhatsApp/Messenger
// video: what happens in it, any spoken words or on-screen text. The
// description is handed back via `remember`, same as image-vision's, so a
// follow-up question works without resending the video.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_CHARS_REMEMBERED = 4_000;

async function run(input: ToolInput, ctx: ToolContext): Promise<ToolResult> {
  const att = input.attachment!;
  const caption = (input.text ?? "").trim();

  const description = await analyzeVideo(att.base64, att.mimeType, caption || undefined);
  if (!description) {
    return {
      reply: `I can see you sent a video, but I'm having trouble watching it right now 🤔 (it might be too large, or an unsupported format) — could you try a shorter clip, or describe what you need in words?`,
      noCharge: true,
    };
  }

  // A caption is a real question/instruction, not just context — answer it
  // directly, grounded in what was actually seen, rather than just repeating
  // the raw description back. No caption → the description itself IS the
  // useful reply, so skip the extra AI round-trip.
  let reply = description;
  if (caption) {
    const system = `You are a sharp, friendly assistant on ${ctx.assistant}'s WhatsApp. Someone sent a video with a caption. You're given a factual description of what's actually in the video (including any spoken words or on-screen text, transcribed) — answer their caption using ONLY that description. Never invent details the description doesn't mention. Be concise and WhatsApp-friendly. Reply in the user's language. Do not say you are an AI.`;
    const user = `WHAT'S IN THE VIDEO:\n${description}\n\nThe sender's caption/question: ${JSON.stringify(caption)}`;
    const answered = await complete(system, user, 500, 0.3);
    if (answered) reply = answered;
  }

  return {
    reply,
    remember: { label: "the video you sent", text: description.slice(0, MAX_CHARS_REMEMBERED) },
  };
}

registerTool({
  id: "video-vision",
  name: "Video understanding",
  description: "Watch a video: describe what happens in it, transcribe any spoken words or on-screen text.",
  cost: 3,
  announce: "🎬 Give me a moment — watching that now...",
  matches: (input) => {
    const att = input.attachment;
    if (!att) return false;
    return /^video\//i.test(att.mimeType);
  },
  run,
});
