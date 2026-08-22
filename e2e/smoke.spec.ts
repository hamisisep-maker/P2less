import { test, expect, type Page, type BrowserContext } from "@playwright/test";

// Real login credentials — the same seeded demo accounts already visible in
// prisma/seed.ts and on /login's own UI (every seed account's password is
// literally "password", shown as the login form's own default value —
// nothing secret here). Using the REAL login form is deliberate, not a
// shortcut: this suite exists specifically to catch what a session-bypass
// debug route can't — real client-side hydration, which is exactly the bug
// class (timeAgo() hydration mismatches, 2026-08-22) that motivated writing
// it. A plain HTTP-status check would have stayed green through that whole
// bug; only a real browser catches it.
const TENANT_EMAIL = "grace@riverside.ac";
const ADMIN_EMAIL = "admin@p2less.io";
const PASSWORD = "password";

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|admin)(\/|$)/, { timeout: 45_000 }); // generous: same first-hit dev-mode cold-compile cost as any other route
}

/** Visit one page in an already-authenticated context and fail on either a
 *  bad HTTP status or ANY console/page error — hydration mismatches surface
 *  as exactly the latter, never the former, which is the whole reason this
 *  suite drives a real browser instead of just checking response codes. */
async function checkPage(page: Page, path: string): Promise<void> {
  const errors = collectErrors(page);
  const response = await page.goto(path, { waitUntil: "load" });
  // NOT networkidle: several pages (the dashboard's notification bell, live
  // clock) poll in the background forever, so "all network activity has
  // stopped" never becomes true and the wait just times out — a false
  // failure unrelated to what this suite is actually checking. Hydration
  // mismatches surface synchronously right after "load", well before any
  // background polling would even fire once, so a short settle buffer is
  // enough to catch them without depending on polling ever going quiet.
  await page.waitForTimeout(500);
  expect(response?.ok(), `${path} returned ${response?.status()}`).toBeTruthy();
  expect(errors, `console/page errors on ${path}:\n${errors.join("\n")}`).toEqual([]);
}

test.describe.serial("Tenant dashboard — every nav page loads clean", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page, TENANT_EMAIL);
  });

  test.afterAll(async () => { await context.close(); });

  const TENANT_PAGES = [
    "/dashboard",
    "/dashboard/channels",
    "/dashboard/conversations",
    "/dashboard/audit",
    "/dashboard/users",
    "/dashboard/faqs",
    "/dashboard/products",
    "/dashboard/sales",
    "/dashboard/delivery",
    "/dashboard/drivers",
    "/dashboard/developers",
    "/dashboard/widget",
    "/dashboard/billing",
    "/dashboard/connectors",
  ];

  for (const path of TENANT_PAGES) {
    test(`${path} loads with no console errors`, async () => { await checkPage(page, path); });
  }
});

test.describe.serial("Super admin — every nav page loads clean", () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await loginAs(page, ADMIN_EMAIL);
  });

  test.afterAll(async () => { await context.close(); });

  const ADMIN_PAGES = [
    "/admin",
    "/admin/tenants",
    "/admin/billing",
    "/admin/billing/automation",
    "/admin/ai",
    "/admin/models",
    "/admin/system-health",
    "/admin/integrations",
    "/admin/reconciliation",
    "/admin/incidents",
    "/admin/tickets",
    "/admin/roles",
    "/admin/security",
    "/admin/settings",
  ];

  for (const path of ADMIN_PAGES) {
    test(`${path} loads with no console errors`, async () => { await checkPage(page, path); });
  }

  // Detail pages need a real, current id — discovered live from the list
  // page rather than hardcoded, so this doesn't rot the moment seed data
  // changes. This is exactly the class of page (ticket-workspace.tsx,
  // incident-row.tsx) the 2026-08-22 hydration audit fixed.
  //
  // Clicks the real link rather than extracting its href and calling
  // page.goto() separately — that two-step pattern hit an intermittent
  // "ERR_ABORTED; maybe frame was detached" on this machine (confirmed via
  // direct manual browser verification that the target page itself renders
  // perfectly with zero console errors — a Playwright navigation-timing
  // quirk in the TEST, not an app bug). A real click is what a user actually
  // does and lets Playwright's built-in navigation waiting handle the rest.
  async function checkFirstDetailPage(page: Page, listPath: string, hrefPrefix: string, skipLabel: string): Promise<void> {
    const errors = collectErrors(page);
    await page.goto(listPath, { waitUntil: "load" });
    await page.waitForTimeout(500);
    const link = page.locator(`a[href^="${hrefPrefix}"]`).first();
    if ((await link.count()) === 0) { test.skip(true, skipLabel); return; }
    await Promise.all([page.waitForURL(new RegExp(hrefPrefix.replace(/\//g, "\\/") + ".+")), link.click()]);
    await page.waitForTimeout(500);
    expect(errors, `console/page errors on a ${hrefPrefix} detail page:\n${errors.join("\n")}`).toEqual([]);
  }

  test("first ticket detail page loads with no console errors", async () => {
    await checkFirstDetailPage(page, "/admin/tickets", "/admin/tickets/", "no tickets seeded");
  });

  test("first incident detail page loads with no console errors", async () => {
    await checkFirstDetailPage(page, "/admin/incidents", "/admin/incidents/", "no incidents seeded");
  });

  test("first tenant detail page loads with no console errors", async () => {
    await checkFirstDetailPage(page, "/admin/tenants", "/admin/tenants/", "no tenants seeded");
  });
});
