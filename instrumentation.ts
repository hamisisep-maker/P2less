// Runs once when the server process starts (Next.js instrumentation hook).
// Starts the delivery-dispatch background poller — the only thing that
// advances a trip when a driver's 5-minute offer window expires with no
// reply, since nothing else in the request/response cycle can wait that long.
// Also starts the billing lifecycle poller — reminders, automated renewal
// charges, retries, grace periods, and suspension all run on a real timer
// here, not only when someone happens to open the admin dashboard.
// Both (and every job below) now execute through job-runner.ts, so every
// tick is a real, observable JobRun row on /admin/system-health.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDispatchPoller } = await import("./src/lib/dispatch");
    startDispatchPoller();
    const { startBillingPoller } = await import("./src/lib/billing-lifecycle");
    startBillingPoller();

    const { registerJob, startJobPoller } = await import("./src/lib/job-runner");
    const { runDbHealthSweep, runIntegrationHealthSweep } = await import("./src/lib/system-health");
    registerJob({ key: "db_health_sweep", name: "Database ping", category: "health", intervalMs: 60_000, run: runDbHealthSweep });
    startJobPoller("db_health_sweep");
    registerJob({ key: "integration_health_sweep", name: "Integration health checks", category: "health", intervalMs: 2 * 60_000, run: runIntegrationHealthSweep });
    startJobPoller("integration_health_sweep");

    const { runReconciliationSweep } = await import("./src/lib/reconciliation");
    registerJob({ key: "reconciliation_sweep", name: "Payment reconciliation sweep", category: "reconciliation", intervalMs: 5 * 60_000, run: runReconciliationSweep });
    startJobPoller("reconciliation_sweep");

    const { runIncidentSweep } = await import("./src/lib/incident-detection");
    registerJob({ key: "incident_sweep", name: "Incident detection sweep", category: "health", intervalMs: 60_000, run: runIncidentSweep });
    startJobPoller("incident_sweep");

    const { runTicketSlaSweep } = await import("./src/lib/ticket-sla");
    registerJob({ key: "ticket_sla_sweep", name: "Support ticket SLA sweep", category: "support", intervalMs: 5 * 60_000, run: runTicketSlaSweep });
    startJobPoller("ticket_sla_sweep");

    const { runNotificationDispatchSweep } = await import("./src/lib/notifications");
    registerJob({ key: "notification_dispatch_sweep", name: "Notification dispatch", category: "notifications", intervalMs: 2 * 60_000, run: runNotificationDispatchSweep });
    startJobPoller("notification_dispatch_sweep");

    const { runSocialTokenHealthSweep } = await import("./src/lib/social-publish");
    registerJob({ key: "social_token_health_sweep", name: "Facebook/Instagram token health", category: "health", intervalMs: 15 * 60_000, run: runSocialTokenHealthSweep });
    startJobPoller("social_token_health_sweep");
  }
}
