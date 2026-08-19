// Daraja C2B "Validation" — called BEFORE Safaricom actually moves the
// customer's money, only if the shortcode is registered with
// ValidationURL != "Completed" (default is auto-complete, validation off).
// This ALWAYS accepts. Rejecting a real payment here means Safaricom does
// NOT collect the money at all — strictly worse than accepting an
// unrecognized reference and reconciling it later via UnmatchedTransaction.
// See ../confirmation/route.ts for the endpoint that actually matters —
// that one fires AFTER the money has already moved.
export async function POST() {
  return Response.json({ ResultCode: 0, ResultDesc: "Accepted" });
}
