// Runs once when the server process starts (Next.js instrumentation hook).
// Starts the delivery-dispatch background poller — the only thing that
// advances a trip when a driver's 5-minute offer window expires with no
// reply, since nothing else in the request/response cycle can wait that long.
// Also starts the billing lifecycle poller — reminders, automated renewal
// charges, retries, grace periods, and suspension all run on a real timer
// here, not only when someone happens to open the admin dashboard.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDispatchPoller } = await import("./src/lib/dispatch");
    startDispatchPoller();
    const { startBillingPoller } = await import("./src/lib/billing-lifecycle");
    startBillingPoller();
  }
}
