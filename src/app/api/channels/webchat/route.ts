import { handleInbound } from "@/lib/conversation";
import { z } from "zod";

// Web-chat channel adapter — a simulator of messaging an organization's own
// number. A thin transport over the shared engine: the browser posts the ORG
// number it is messaging (toNumber) and the sender's number (fromNumber); the
// engine routes by toNumber → tenant, exactly like the WhatsApp webhook.
const schema = z.object({
  toNumber: z.string().min(1), // the organization number being messaged
  fromNumber: z.string().min(1), // the sender's number
  text: z.string().max(2000).optional().default(""),
  displayName: z.string().max(120).optional(),
  // Super-app: an attached file to run a tool on (base64). Optional.
  file: z.object({ base64: z.string().min(1), filename: z.string().min(1), mimeType: z.string().default("application/octet-stream") }).optional(),
}).refine((d) => (d.text && d.text.trim().length > 0) || d.file, { message: "text or file required" });

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const result = await handleInbound({
    toNumber: parsed.data.toNumber,
    fromNumber: parsed.data.fromNumber,
    channelType: "webchat",
    text: parsed.data.text ?? "",
    displayName: parsed.data.displayName,
    attachment: parsed.data.file,
  });
  return Response.json(result);
}
