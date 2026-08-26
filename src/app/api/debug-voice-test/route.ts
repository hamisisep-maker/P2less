import { synthesizeVoiceReply } from "@/lib/voice-reply";

// TEMPORARY debug route — verifies the full TTS->WAV->Opus/OGG pipeline
// against production's real ffmpeg. Deleted immediately after this check.
export async function GET() {
  const buf = await synthesizeVoiceReply("Hello! This is a production test of the voice reply feature.");
  if (!buf) return Response.json({ ok: false, error: "synthesis returned null" });
  return Response.json({ ok: true, bytes: buf.length, firstBytesHex: buf.subarray(0, 16).toString("hex") });
}
