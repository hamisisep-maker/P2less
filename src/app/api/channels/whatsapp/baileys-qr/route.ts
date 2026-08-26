import QRCode from "qrcode";
import { withTenantUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getPendingQr } from "@/lib/whatsapp-baileys";

// Polled by the dashboard's connect/switch Modal while a WhatsApp number is
// pairing over the unofficial (Baileys) transport — same shape as
// api/payments/status's poll-by-reference route. Scoped to the requesting
// tenant's own number (never trust a bare numberId query param alone).
export async function GET(req: Request) {
  return withTenantUser(async (user) => {
    const numberId = new URL(req.url).searchParams.get("numberId");
    if (!numberId) return Response.json({ error: "numberId required" }, { status: 400 });

    const number = await db.whatsAppNumber.findFirst({ where: { id: numberId, tenantId: user.tenantId! } });
    if (!number) return Response.json({ error: "not found" }, { status: 404 });

    if (number.verificationStatus === "verified") {
      return Response.json({ connected: true, phoneNumber: number.phoneNumber });
    }

    // Set by whatsapp-baileys.ts when a scanned number turns out to already
    // be actively connected elsewhere (Meta or another unofficial number) —
    // an honest failure, not an indefinite "waiting for a code".
    if (number.verificationStatus === "failed") {
      return Response.json({ connected: false, failed: true, error: "This number is already connected elsewhere. Disconnect it there first, then try again." });
    }

    const qr = await getPendingQr(numberId);
    const qrDataUrl = qr ? await QRCode.toDataURL(qr, { margin: 1, width: 280 }) : null;
    return Response.json({ connected: false, qr: qrDataUrl });
  });
}
