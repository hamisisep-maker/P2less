import "server-only";
import { spawn } from "node:child_process";
import { synthesizeSpeech } from "./ai";

// ─────────────────────────────────────────────────────────────────────────────
// Voice-note replies, 2026-08-26 — the reply-side counterpart to voice-note
// LISTENING (transcribeAudio). Gemini TTS hands back raw PCM (24kHz, 16-bit,
// mono, confirmed against Google's own docs) — not a playable file on its
// own. Two real conversions stand between that and a genuine WhatsApp voice
// note: wrap the PCM in a WAV container (pure JS, a fixed 44-byte header,
// no external tool needed), then transcode that WAV to Opus/OGG (needs
// ffmpeg — WhatsApp voice-note bubbles specifically expect Opus, confirmed
// via railpack.json's deploy.aptPackages addition + a boot-time version
// check in prod-start.mjs before this file was written).
// ─────────────────────────────────────────────────────────────────────────────

const PCM_SAMPLE_RATE = 24_000;
const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;

/** Wrap raw 16-bit PCM in a standard 44-byte WAV header. */
function pcmToWav(pcm: Buffer): Buffer {
  const byteRate = (PCM_SAMPLE_RATE * PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8;
  const blockAlign = (PCM_CHANNELS * PCM_BITS_PER_SAMPLE) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(PCM_CHANNELS, 22);
  header.writeUInt32LE(PCM_SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(PCM_BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Pipe a WAV buffer through ffmpeg to Opus/OGG — no temp files, stdin in,
 *  stdout out. Returns null (never throws) if ffmpeg isn't on PATH or the
 *  conversion fails, so a caller always has a clean "voice reply isn't
 *  available right now" fallback to text rather than a hard crash. */
function wavToOpusOgg(wav: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const ff = spawn("ffmpeg", ["-i", "pipe:0", "-c:a", "libopus", "-b:a", "32k", "-vn", "-f", "ogg", "pipe:1"]);
    const chunks: Buffer[] = [];
    let stderr = "";
    ff.stdout.on("data", (c: Buffer) => chunks.push(c));
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    ff.on("error", (e) => {
      console.error("[voice-reply:ffmpeg-spawn-failed]", e.message);
      resolve(null);
    });
    ff.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        console.error(`[voice-reply:ffmpeg-failed] exit=${code} stderr=${stderr.slice(-300)}`);
        resolve(null);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    ff.stdin.end(wav);
  });
}

/** Full pipeline: text → Gemini TTS (raw PCM) → WAV → Opus/OGG. Returns a
 *  buffer ready to send as a real WhatsApp voice note, or null anywhere
 *  along the chain — always a safe signal to fall back to a text reply
 *  instead, never a thrown error a caller has to handle specially. */
export async function synthesizeVoiceReply(text: string): Promise<Buffer | null> {
  const pcm = await synthesizeSpeech(text);
  if (!pcm) return null;
  const wav = pcmToWav(pcm);
  return wavToOpusOgg(wav);
}
