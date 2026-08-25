import { db } from "@/lib/db";
import { runCrossTenant } from "@/lib/tenant-context";

// TEMPORARY — verifying the real (non-self-signed) Stripe webhook delivery
// after registering the production endpoint. Remove in the very next commit.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  if (token !== process.env.CREDENTIAL_KEY) {
    return new Response("Not found", { status: 404 });
  }
  const events = await runCrossTenant(() =>
    db.inboundEvent.findMany({
      where: { source: "stripe_webhook" },
      orderBy: { receivedAt: "desc" },
      take: 5,
    })
  );
  return Response.json({ events });
}
