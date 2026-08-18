// Runs once when the server process starts (Next.js instrumentation hook).
// Starts the delivery-dispatch background poller — the only thing that
// advances a trip when a driver's 5-minute offer window expires with no
// reply, since nothing else in the request/response cycle can wait that long.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDispatchPoller } = await import("./src/lib/dispatch");
    startDispatchPoller();
  }
}
