# How to use the test guides — one page, start to finish

Companion to the [Five-Tenant Readiness Dossier](PRODUCTION-READINESS-TEST-PLAN-2026-08-27.md) and its two PDFs:

- **Volume I — [TEST-EXECUTION-GUIDE-TENANTS-1-4-2026-08-27.pdf](TEST-EXECUTION-GUIDE-TENANTS-1-4-2026-08-27.pdf)** — the four honest, paying tenants.
- **Volume II — [ABUSERS-FIELD-MANUAL-TENANT-5-2026-08-27.pdf](ABUSERS-FIELD-MANUAL-TENANT-5-2026-08-27.pdf)** — the one tenant who never pays.

This page is the thing to read *before* either PDF — it says what order to do things in and what to do with what you find.

## The order to actually run this in

1. **Read Volume I's "Tools" chapter first**, even if you think you don't need it. It tells you which of Chrome DevTools / the admin console / Prisma Studio you'll need and how to open each one. Do this once, before Tenant 1.
2. **Run Tenants 1–4, one at a time, in order**, straight through Volume I. Each tenant is self-contained — sign up, connect its one channel, upgrade to its plan, then the "Verify before moving on" box at the end of each. Don't skip that box; it's the admin-side check, and it's easy to forget once the tenant's own dashboard looks right.
3. **Do the "Payment edge cases" and "Three simulated months" chapters last**, after all four tenants exist — they deliberately reach across all four rather than being tied to one.
4. **Only then move to Volume II and Tenant 5.** It's written to stand alone, but a couple of its checks (the "wrong-person" face-verification test, the tenant-id substitution in Real Request Tampering Technique 4) are more meaningful once you have Tenant 1's real session to compare against.
5. **Volume II's own "Toolbox" chapter is a second, one-time setup step** — Burp Suite and (optionally) a VPN — separate from Volume I's tools. Do that installation once, before Vector 1.

## While you're running it

- Every step is tagged **YOU** (you click it) or **TECH** (an engineer stages it — usually in Prisma Studio). If you're doing this solo, you're playing both roles; just follow the tag to know which tool that particular step needs.
- Every step ends with an **Expect** or **How to know it worked** line. Don't move to the next step until what you see matches that line. If it doesn't, that's not necessarily a bug in the guide — it might be the actual finding. Write it down either way.
- Each volume ends with a **Result log** table. Use it as you go, not after — a note like "Tenant 2, Messenger connect, blocked by no test Facebook Page, not a bug" is as valuable a row as a real failure.
- Each cover page has a **coverage map** — if you're ever unsure which chapter tests something specific (rate limits, a disabled button, the OTP code), check that table before searching page by page.

## If something breaks

Stop on that step, don't route around it. Two different things "breaking" mean different things:

- **In Volume I** (an honest tenant hits something wrong): note the exact step, what the guide said to expect, and what actually happened. This is a normal bug report — screenshot if it's visual, or a DevTools "Copy as cURL" of the request if it's about a response.
- **In Volume II** (an abuse technique actually works): stop probing that specific hole further once you've confirmed it. Save the request (Burp's "Copy as curl command," or DevTools' "Copy as cURL") and the response, exactly as both manuals say at the end of the tampering chapter. These are the findings worth bringing back first — everything in Volume II is ranked so the identity/session tests and the balance-inflation tests are the highest-value ones if your time runs short.

## What "done" looks like

Both Result Log tables filled in, end to end, for all five tenants. At that point you have a real, first-hand answer to the original question this whole exercise started from — not just "does it look right," but "did I, personally, try to break it, and what happened when I did."

---
*Written 2026-08-27, alongside both PDF volumes.*
