# Production readiness test plan — 5 simulated tenants

**Status: PROPOSAL — not yet started.** Written 2026-08-27 in response to a direct request to prove the system end-to-end before real customers rely on it: real accounts, real plans, real payments (including the messy real-world cases — partial payments, delayed settlement), real audit trail, real 3-month usage pattern, and a real abuse attempt — all against **production**, all documented, so there's a real record of "this was checked" rather than an assumption.

**Hard constraint carried through every step below: no real AI provider calls.** The user is reserving real AI usage for training once the WhatsApp restriction lifts. Every step that needs "usage" to exist is done either through a channel/path that never reaches an AI provider (deterministic flows — OTP entry, numbered-menu taps, connector lookups that return templated text) or by directly recording the *effect* of usage (a `UsageEvent`/`AiRequestLog` row) rather than triggering the real call that would normally produce it. This is flagged explicitly at every step where it applies.

---

## The five tenants — descriptive, identical structure

| | Name | Plan path | Channel | Role in the test |
|---|---|---|---|---|
| **Tenant 1** | Tenant 1 — WhatsApp Only | 7-day trial → **Starter** | WhatsApp (widget for admin testing) | Normal small customer |
| **Tenant 2** | Tenant 2 — Messenger Only | 7-day trial → **Professional** | Messenger | Normal mid-size customer |
| **Tenant 3** | Tenant 3 — Telegram Only | 7-day trial → **Business** | Telegram | Normal larger customer |
| **Tenant 4** | Tenant 4 — Widget Only | 7-day trial → **Enterprise** | Website widget | Negotiated/postpaid customer |
| **Tenant 5** | Tenant 5 — Abuse Attempt | 7-day trial → never pays → creates a second account | Whatever's convenient for the abuse method being tried | The adversary |

Deliberately one real channel per tenant (not "test everything on Tenant 1") — this is what actually surfaces channel-specific gaps: if Messenger's media handling, Telegram's onboarding copy, or the widget's OTP-blocked message is broken, it'll only show up if that channel is genuinely exercised end to end, not just unit-tested in isolation.

---

## Phase 0 — Setup discipline (read before starting)

- Every step gets a **result row** in the log table at the bottom of this doc: what was done, what was expected, what actually happened, pass/fail, and a note if it needs a code fix. This doc IS the artifact that proves readiness — an unlogged step didn't happen.
- All five tenants use throwaway `@example.com` emails and clearly-fake phone numbers in an obviously-test range, named exactly as in the table above, so they're trivially identifiable and safe to delete afterward.
- Real M-Pesa STK pushes in production go through Safaricom's real Daraja API. **Unless real payment testing is explicitly wanted, default to the mock/demo path or a self-signed webhook payload** (the same technique already used and documented in GAP-REGISTER item covering the Stripe Checkout verification) — confirm with the user which payment methods should use real money movement vs. simulated settlement before Phase 3 starts.
- Because no real AI calls are allowed, "3 months of usage" is **simulated by inserting real `UsageEvent`/`Message`/`AiRequestLog` rows dated across a 3-month span**, not by waiting 3 real months or sending 90 days of real AI-triggering messages. This is called out again in Phase 4.

---

## Phase 1 — Real signup, all five tenants (trial state)

For each tenant: complete the real `/onboard` flow (org name, industry, phone, OTP verify) — no shortcuts, this is the exact path a real customer uses.

**Check and log, per tenant:**
1. Tenant + Subscription created with `status: "trial"` and a real `trialEndsAt` ~7 days out (not null, not perpetual).
2. Dashboard loads without error; the new `UsageBalanceCard` shows "X days left," 0/200 messages, 0/100 AI requests, matching the corrected Free-plan limits (item 30).
3. Admin side: the tenant appears in `/admin/tenants` with correct name, industry, plan, status, owner email — no stale/placeholder data.
4. Real audit entries exist for account creation (`audit()` calls already wired into `finalizeOnboarding()` — confirm they actually fired, not just that the code path exists).

---

## Phase 2 — Channel connection, one per tenant

Connect exactly the one channel assigned in the table above, for real, through the real dashboard flow (not a database shortcut):

- **Tenant 1 (WhatsApp)**: connect via whichever transport is actually usable right now — if the unofficial transport is still inside its WhatsApp-imposed cooldown window, use the web widget's own WhatsApp-style simulator instead, and note honestly in the log which one was actually used and why.
- **Tenant 2 (Messenger)**: connect a real test Facebook Page if one exists; if not, log this as a real external-dependency gap rather than skipping silently.
- **Tenant 3 (Telegram)**: real bot token via @BotFather — this one is genuinely free/instant/self-service, no excuse to skip it.
- **Tenant 4 (Widget)**: create a real widget key, embed-test it.

**Check and log, per tenant:** the channel shows "connected" correctly on both the tenant dashboard and the admin tenant-detail view; the connection status badges (`whatsappConnectionStatus()` etc.) show the right color/label for a genuinely healthy connection, not a stale/misleading one.

---

## Phase 3 — Four tenants upgrade to their real plan

Tenants 1–4 each go through the real self-service upgrade flow (`UpgradeModal`, Billing page) to Starter / Professional / Business / Enterprise respectively.

**Check and log, per tenant:**
1. The real invoice math is correct — trial-plan-value credit (0, since Free prices at 0), full plan price, correct `payableKes`.
2. **Test every real payment outcome, not just the happy path** — this is explicitly requested and is the actual point of this phase:
   - **Full payment, clean**: pay the full amount in one shot (mock/simulated per Phase 0's note). Confirm plan switches, balance/status updates, a real `invoice.settled` audit entry with correct detail.
   - **Partial payment (Paybill-style)**: simulate a payment that's less than `payableKes` landing. Confirm the invoice correctly shows "partial, KES X still due" and does **not** prematurely mark the tenant as upgraded — the existing `paybill_partial` step's own rule ("never show upgraded on a partial payment") should hold.
   - **"Paid but money hasn't arrived" (the classic real-world case)**: simulate the STK/Paybill flow timing out — no payment confirmation received within the poll window. Confirm the UI degrades honestly ("still waiting, we'll apply it automatically" / "check your phone or try again") rather than either falsely claiming success or leaving the tenant in a broken, unrecoverable state. Confirm a LATE-arriving payment (after the timeout) still correctly settles when it eventually lands — this is the actual scenario Paybill's out-of-band design exists to handle.
   - **Failed/cancelled payment**: confirm the tenant's plan is genuinely untouched, and they can retry cleanly.
3. Admin side: `/admin/billing` (or wherever platform-wide revenue lives) shows this payment correctly — real amount, real tenant, real timestamp.

---

## Phase 4 — Simulated 3 months of usage, no real AI calls

For Tenants 1–4 (the paying ones), simulate 3 months of real-looking activity **without triggering real AI provider calls**:

- Insert real `UsageEvent` rows (`message_in`, `message_out`, `ai_request`, `document`) dated across the 3-month span, at a volume appropriate to each tenant's plan (e.g., Tenant 1/Starter well under 2,000/mo, Tenant 3/Business scaling toward but not exceeding 100,000/mo — deliberately including one month where a tenant's usage genuinely approaches or crosses their real limit, to test the actual gate, not just the happy path).
- For a handful of REAL messages per tenant (not 90 days' worth), use a genuinely deterministic reply path that needs no AI call at all — a numbered-menu tap, an OTP-code entry, a connector lookup with a templated response — to confirm the real message-send pipeline, real `Message` rows, and real conversation threading all work end to end, with the bulk of "3 months" represented by the inserted `UsageEvent` history instead.
- Also directly insert a handful of real `AiRequestLog` rows (with realistic `costUsd`/`costKes`/`revenueKes` figures, matching real `ModelPricing`) to exercise the profit-tracking check below, WITHOUT calling a real AI provider — this is the deliberate way to test cost/revenue accounting while honoring the "no real AI usage" constraint.

**Check and log, per tenant:**
1. **Usage exhausting correctly**: at least one tenant's simulated usage crosses their plan's real cap (item 32's fix) mid-simulation — confirm `checkLimit()` correctly blocks further messages that month, and correctly resets the next simulated month.
2. **Balance depleting correctly**: confirm `messageBalanceKes`/`aiBalanceKes` draw down as expected against the simulated `UsageEvent` volume and the real `price_conversation_kes`/`price_ai_kes` rates — the numbers should be mechanically checkable by hand, not just "looks about right."
3. **Dashboard correctness**: each tenant's own dashboard shows the right message-volume trend chart, the right usage/balance card state, the right conversation counts — spot-check the numbers against what was actually inserted, not just that something renders.
4. **Admin correctness**: `/admin` overview and `/admin/tenants/[id]` show correct aggregate numbers for each tenant — message volume, revenue, plan — cross-checked against the same source data.
5. **Is P2Less making a profit**: for the AI-cost-simulated tenant(s), directly compare `revenueKes` (from `AiRequestLog`/the message price) against the real `costUsd`→KES cost recorded on the same rows, at the real `ModelPricing` your actual providers charge — confirm the margin is genuinely positive, not assumed. Do this per tenant AND as a platform-wide total across all four.
6. **Is the money tracked the way it's supposed to**: reconcile — total `Payment` amounts marked "paid" for these tenants should equal what the invoices said was owed; total `UsageEvent`-implied cost should reconcile against what was actually charged/debited from balances; nothing should be double-counted or silently lost.
7. **Are actions logged**: pull the real audit trail for each tenant across the whole simulated period — plan changes, payments, balance debits/credits, connector actions if any were exercised — confirm nothing material happened without a corresponding audit row, and confirm `verifyAuditChain()`'s tamper-evidence still holds across this volume of real entries.

---

## Phase 5 — Tenant 5, the abuse attempt

Tenant 5 stays on the Free trial (per the scenario) and, instead of ever paying, **tries to abuse the system**. Test every real method available, not just the obvious one:

1. **Multiple trial accounts** — once Tenant 5's 7-day trial genuinely expires (real gate, item 32), attempt to sign up again with a different email/org name but overlapping details (same phone number, similar org name) to get a second free trial. Check: does anything catch or flag this? (Direct, honest expectation: probably not today — no cross-tenant dedup on phone/org-similarity exists yet. Document this as a real, confirmed gap if so, not something to quietly patch mid-test.)
2. **Racing the payment/invoice supersede logic** — rapidly click "Upgrade" to different plans / different top-up amounts in quick succession, confirm the real compare-and-swap logic (`invoicePendingKey` unique constraint, invoice-superseding) holds and never creates two live payment attempts for the same tenant.
3. **Trying to exceed the trial's hard limit through a channel other than the one being counted** — e.g., message via widget AND WhatsApp simultaneously, check whether the count limit is genuinely tenant-wide (correct) or accidentally per-channel (a real bypass, if so).
4. **Attempting to access another tenant's data** — the exact tenant-isolation check already covered by this codebase's existing regression suite (`each tenant has its own contacts`, etc.), but re-run manually as a real user action from Tenant 5's own session against Tenant 1–4's real IDs, not just the automated suite, to catch anything the suite's synthetic data wouldn't.
5. **Payment-side abuse**: attempt to submit a fabricated/mismatched Paybill account reference (a real invoice number that isn't theirs) to see if a payment could be misattributed to the wrong tenant.
6. **OTP/session abuse**: reuse an already-consumed OTP code (already directly observed during Phase 1's own live signup verification — confirmed correctly rejected); attempt rapid OTP resend to see if the real rate-limit (`rateLimit()`, `actions.ts`) holds.

**Every attempt gets logged as a real result** — confirmed blocked, confirmed NOT blocked (a real gap), or inconclusive — regardless of outcome. A clean report where every abuse attempt failed is exactly as valuable as one that finds a real gap; both are real findings.

---

## Result log

*(Filled in as each phase actually runs — this table is the actual evidence, not a placeholder.)*

| Phase | Step | Expected | Actual | Result | Notes / follow-up needed |
|---|---|---|---|---|---|
| — | — | — | — | *(not started)* | — |

---

## Explicitly not in this test plan

- Real AI provider usage of any kind (per the hard constraint above) — a separate, later pass once the WhatsApp restriction lifts and real training resumes.
- Load/scale testing (covered separately in `SCALING-MIGRATION-SCOPE-2026-08-27.md` — this plan is about correctness, not throughput).
- Real money movement unless explicitly confirmed with the user first (Phase 0's note) — default to mock/simulated settlement.
- Marketing/outbound messaging (out of scope per `OUTBOUND-MARKETING-MESSAGING-SCOPE-2026-08-27.md`, not built yet).

## Next step

This is a proposal — review the phase structure, the tenant/channel assignments, and the mock-vs-real-payment decision above, then say go and Phase 1 starts for real, one tenant and one logged result at a time.
