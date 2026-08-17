// Test-only webhook sink — records recent deliveries so the test suite can verify
// that P2Less actually POSTs signed events. Disabled in production.
const g = globalThis as unknown as { __whSink?: { event: string | null; signature: string | null; body: string }[] };
g.__whSink ??= [];

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return new Response("disabled", { status: 404 });
  const body = await req.text();
  g.__whSink!.unshift({ event: req.headers.get("x-p2less-event"), signature: req.headers.get("x-p2less-signature"), body });
  g.__whSink = g.__whSink!.slice(0, 20);
  return Response.json({ received: true });
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return new Response("disabled", { status: 404 });
  return Response.json({ deliveries: g.__whSink ?? [] });
}
