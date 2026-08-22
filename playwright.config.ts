import { defineConfig } from "@playwright/test";

// E2E smoke suite (docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md, "safer
// verification" — 2026-08-22). Defaults to local dev; point E2E_BASE_URL at
// a staging/production URL to smoke-test a real deploy without needing a
// session-bypass debug route.
export default defineConfig({
  testDir: "./e2e",
  // Generous for `next dev`'s on-demand Turbopack compilation — the FIRST
  // hit on an unvisited route pays a real cold-compile cost (confirmed via
  // direct timing: ~3.5s cold vs ~0.4s warm for one route alone) on top of
  // whatever else is competing for CPU. A production/staging E2E_BASE_URL
  // never pays this cost at all, since nothing there compiles on request.
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    trace: "retain-on-failure",
  },
});
