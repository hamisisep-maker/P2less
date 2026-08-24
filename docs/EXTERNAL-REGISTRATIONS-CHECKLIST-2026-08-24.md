# External registrations & provider-side setup — master checklist

**Purpose**: every item on this list is code-complete on P2Less's own side. What remains is a real action on an external provider's dashboard/review process, or a decision only the user can make (business identity, credentials, risk tolerance) — not more building. Created 2026-08-24 to consolidate everything scattered across `ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md`, `SYSTEM-DISCOVERY-2026-08-19.md`, and this session's chat history into one place, so nothing gets lost between sessions. Each item cites its source so the full reasoning/history can be pulled back up.

**How to use this doc**: work items in any order — none block each other except where noted. When an item is finished, mark it `✅ DONE <date>` in place (don't delete the row — keep the history) and, if it unblocks follow-on engineering work (e.g. Resend inbound → the email channel actually testable), say so in the chat so the next step gets picked up.

**Evidence audit, 2026-08-24**: every item below was re-verified against real, current evidence today — the user's own live, logged-in Meta Business Manager session (via a connected browser), the Railway CLI (`railway variables`), and this app's own database — not re-stated from memory. Each item now carries an **Evidence** line citing exactly what was checked. Three real findings came out of this pass: a new, time-sensitive risk (below), one item corrected as already shipped, and one item's stated problem corrected to match what's actually true today.

> ⚠️ **New, urgent finding — Meta Access (Tech Provider) verification, not previously tracked separately from Business Verification.** Live-checked in Meta Business Suite → Business info → Access verification status: **"Not verified — Your business was not verified as a Tech Provider and API calls to certain permissions and features in advanced access will begin to be blocked."** This is Meta's own live warning, not a hypothetical — it threatens the WhatsApp/Messenger integration that's already working in production today, not just the paused Phase 9 work. It's closely related to item #1 (Business Verification) but is a distinct status Meta tracks separately, and its consequence (active features breaking) is more urgent than #1's framing as "deliberately deferred" suggests. Worth treating as higher priority than its position in this list implies — see item #1 for the actual next action, since completing Business Verification is what resolves both.

---

## Meta (WhatsApp, Messenger, Instagram) — one Business Manager, one App (`2450932552082438`, "Hamzone Technologies")

### 1. WhatsApp — Business Verification
- **Status**: not started. Deliberately deferred 2026-08-21 ("keep building around it for now") — but see the urgent-finding callout above, since the consequence of staying deferred is now more concrete than when that call was made.
- **Evidence (2026-08-24, live)**: Meta Business Suite → Settings → Business info: "Business verification status: **Unverified** — Your business must be verified to access certain Meta products." Directly below it, "Access verification status: **Not verified** — API calls to certain permissions and features in advanced access will begin to be blocked."
- **Next action**: log into the Meta Business Manager (Hamzone Technologies portfolio) as an admin → complete "Verify your business" under the Tech Provider onboarding checklist. Needs real legal/business identity documents.
- **Blocked on**: you directly — Meta requires the actual Business Manager admin to do this, not driveable by browser automation on your behalf.
- **Unblocks**: WhatsApp App Review submission (#3 below), possibly Coexistence mode (unconfirmed prerequisite, see #4), and clears the active-feature-blocking risk in the urgent finding above.
- **Source**: roadmap §Phase 9, lines 663, 667; live-reverified 2026-08-24.

### 2. WhatsApp — a spare/test phone number for Embedded Signup
- **Status**: paused — confirmed 2026-08-24 you don't have one ready yet.
- **Next action**: once you have a genuinely spare/never-used number, click "Connect via Meta" on `/dashboard/channels` and complete the hosted flow against it.
- **Blocked on**: you having a spare number. **Caution, confirmed against Meta's docs**: registering a number this way disconnects it from the regular consumer/Business WhatsApp app until a full delete + cooldown migration back — don't use a number you're actively using elsewhere. See item #4 for a possible alternative.
- **Unblocks**: observing the real `account_update` webhook payload → wiring the final `wabaId`/`phoneNumberId` finalization logic (currently unbuilt on purpose, to avoid guessing the payload shape).
- **Source**: roadmap §Phase 9, lines 677-696; this session's 2026-08-24 confirmation.

### 3. WhatsApp — App Review submission
- **Status**: not started.
- **Next action**: review app settings, record a video demonstrating real send/template-management (already works today — no new building needed to record it), submit requesting `whatsapp_business_management`/`whatsapp_business_messaging` at Advanced Access.
- **Blocked on**: Business Verification (#1) should land first; also needs a completed real signup (#2) to have something concrete to demonstrate.
- **Unblocks**: onboarding real clients' own WhatsApp numbers (today only the app's own test WABA can be used).
- **Source**: roadmap §Phase 9, line 681.

### 4. WhatsApp — Coexistence mode (alternative to #2, not yet evaluated as safe)
- **Status**: researched, not attempted. A real alternative that lets a business keep their existing WhatsApp number working normally while also connecting it to the Cloud API — avoids #2's reversibility risk entirely.
- **Next action**: if a spare number never materializes, this is the fallback — but confirm first whether it requires completed Business Verification (unconfirmed in Meta's own docs).
- **Blocked on**: the Business-Verification-prerequisite question is unresolved; you explicitly chose to wait for a spare number over testing this path (2026-08-22).
- **Source**: roadmap §Phase 9, lines 694-696.

### 5. WhatsApp — access-token expiry monitoring — ✅ DONE 2026-08-24
- **Status**: **shipped.** A real live-check via Meta's `debug_token` endpoint now runs inside `checkWhatsAppHealth()` (shared with Messenger's own check via `src/lib/meta-token-health.ts`), and a new incident-detection check opens a real platform Incident if the shared token ever goes invalid. Full detail: Operations Guide §66.
- **Still open, not this item's scope**: whether `WHATSAPP_ACCESS_TOKEN` is a genuine permanent System User token vs. a 24-hour temporary one is unconfirmed either way — but it no longer matters silently, since it would now be actively detected and alerted on the moment it died, regardless of which kind it is.
- **Source**: `SYSTEM-DISCOVERY-2026-08-19.md` line 53; shipped 2026-08-24, `OPERATIONS-GUIDE-2026-08-23.md` §66.

### 6. Messenger — add the test sender as a Meta App Tester
- **Status**: NOT done, despite an earlier chat exchange that briefly said otherwise — corrected by you directly (2026-08-21). Paused on the "Add people to your app" → Roles → Tester screen, with "Tester" already selected as the role.
- **Evidence (2026-08-24, live)**: App roles page shows **"Testers 0 of 50"** — confirmed zero testers currently added, matching this status exactly.
- **Next action**: search for and confirm the invite for the specific Facebook account that will send the test message; that account then needs to accept the invite; then resend a real message from that account to the connected Page ("Hamzone Technologies LTD"). **I don't know which Facebook account this should be** — tell me the account (or handle it yourself directly in the App roles → Testers screen) and I can add the invite for you once you confirm who.
- **Blocked on**: you (or whoever controls that Facebook account) completing the invite-accept step — I can't act on someone else's Facebook login.
- **Unblocks**: proving the full Messenger inbound round-trip (webhook → `handleInbound()` → grounded reply → Send API) end-to-end. Everything on P2Less's own side is already built, deployed, and correctly wired.
- **Source**: roadmap §Phase 8a, lines 214-215.

### 7. Instagram DMs — App Review (no dev-mode exception, unlike Messenger)
- **Status**: not started at all. `instagram_business_manage_messages` (the current permission name — Meta's own dashboard, not `instagram_manage_messages` as earlier written) requires App Review with zero dev-mode testing exception — genuinely different from Messenger's "Ready for testing" permissions.
- **Evidence (2026-08-24, live)**: Instagram API → Permissions and features → `instagram_business_manage_messages` shows **no approval status and no request status at all** ("—"/"—") — confirms not merely pending, genuinely never requested.
- **Next action**: submit alongside WhatsApp's App Review (#3) if you want to batch it — video documentation can be shared/reused.
- **Blocked on**: a deliberate reordering decision already made — build and fully live-test Messenger first, submit Instagram in parallel.
- **Source**: roadmap §Phase 8a, line 197; live-reverified 2026-08-24.

### 8. Phase 8c (auto-publish to Facebook/Instagram) — real permission re-verification
- **Status**: code built and structurally correct against Meta's documented contracts. **Corrected 2026-08-24 — the real gap is bigger than "unconfirmed":** neither permission has been requested at all yet, not just unverified.
- **Evidence (2026-08-24, live)**: `instagram_content_publish` shows no approval/request status ("—"/"—"), same as `instagram_business_manage_messages` above. `pages_manage_posts` doesn't even appear in the app's current Messenger permission list — checked the "Add more use cases" dialog directly, and its parent use case ("Manage everything on your Page" — the Pages API, which is what would carry `pages_manage_posts`) is still listed under **available to add**, meaning it was never added to this app at all.
- **Next action**: add the "Manage everything on your Page" use case (via Use cases → Add use cases → Content management), then request `pages_manage_posts` there, alongside Instagram's App Review (#7) and WhatsApp's (#3) — this is a real registration step, not just a click-through to re-check something already working.
- **Blocked on**: nothing except doing it — but it's real setup work, not just verification as previously stated.
- **Source**: roadmap §Phase 8c, line 248; live-reverified and corrected 2026-08-24.

---

## Telegram

### 9. A real `@BotFather`-created bot token
- **Status**: fully built, error path live-verified against a deliberately fake token. Never tested against a real token.
- **Next action** (walked through in chat 2026-08-24, reproduced here for permanence):
  1. Open Telegram (app or [web.telegram.org](https://web.telegram.org)) on your own account.
  2. Search for **@BotFather** (the official bot, verified) and start a chat.
  3. Send `/newbot`.
  4. Give it a **display name** (anything, e.g. "Hamzone Support"), then a **username** — must be unique and end in `bot` (e.g. `HamzoneSupportBot`).
  5. BotFather replies with the token — looks like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyz`.
  6. Paste that token directly into the **Connect Telegram** form on `/dashboard/channels` yourself (not through chat — same reason a live credential never gets typed into the conversation; it validates via a real `getMe` call before saving anything).
  7. Send the bot a real message from Telegram (search its username → Start → type anything) to prove the full inbound round-trip (webhook → `handleInbound()` → grounded reply → `sendTelegramText()`) — the one thing never yet tested against a real token.
- **Blocked on**: nothing — this is the single fastest item on this entire checklist to close, no approval process at all.
- **Source**: roadmap §Phase 8d, line 261; chat 2026-08-24.

---

## Email (Resend)

### 10. Resend Inbound dashboard setup
- **Status**: not started (confirmed directly against both local `.env` and Railway production variables 2026-08-24 — `RESEND_INBOUND_DOMAIN`/`RESEND_WEBHOOK_SECRET` are unset in both).
- **Evidence (re-checked 2026-08-24)**: `railway variables` shows neither key present; local `.env` shows neither key present. Unchanged since first confirmed.
- **Next action** (walked through in chat 2026-08-24, reproduced here for permanence):
  1. Pick a receiving domain: **fast path** — use Resend's auto-provisioned `.resend.app` domain (zero DNS work, ready instantly); **or** a custom domain/subdomain (needs MX records — use a *subdomain* if your root domain already has real MX records for existing email, to avoid conflicts). Found at [resend.com/emails](https://resend.com/emails) → **Receiving** tab → **⋯** menu → **Receiving address**.
  2. Create the webhook: [resend.com/webhooks](https://resend.com/webhooks) → **Add Webhook** → endpoint `https://p2less-app-production.up.railway.app/api/channels/email/webhook` → event **`email.received`** only → **Add**.
  3. Copy the signing secret (`whsec_...`) from that webhook's detail page.
  4. Set both env vars in Railway: `RESEND_INBOUND_DOMAIN` (the domain from step 1) and `RESEND_WEBHOOK_SECRET` (the full `whsec_...` string from step 3).
- **Blocked on**: nothing except doing it — no approval process, entirely self-service in the Resend dashboard.
- **Unblocks**: the Email channel going live (code, including the hand-verified Svix signature check, is fully built and waiting).
- **Source**: chat 2026-08-24; roadmap §Phase 8d, lines 269-271.

---

## SMS (OTP delivery — Advanta / Africa's Talking)

### 11. Real-account test of SMS delivery
- **Status**: both providers' integrations are correct per their documented API contracts, but neither has ever been tested against a real account — no real credentials exist yet. Currently, with no provider configured, OTP codes are echoed directly in the UI labeled "Demo only."
- **Next action**: obtain real credentials from either Advanta or Africa's Talking (Africa's Talking is the automatic fallback if both are configured), set the relevant env vars, send a real OTP to a real phone.
- **Blocked on**: you creating a real account with one (or both) of these providers.
- **Source**: roadmap line 762 (Track A phone verification), line 857 (trial-abuse hardening summary).

---

## M-Pesa (Safaricom Daraja) — currently sandbox only

### 12. Daraja production "Go-Live" application
- **Status**: `MPESA_ENV="sandbox"` — real STK pushes work end-to-end today, confirmed reaching a real phone, but against Safaricom's sandbox environment, not real production payments.
- **Evidence (2026-08-24)**: `railway variables` confirms `MPESA_ENV=sandbox` live in production right now. Unchanged.
- **Next action**: Safaricom's Daraja portal (developer.safaricom.co.ke) has a formal Go-Live application process to get a production shortcode/passkey/consumer-key+secret — this is a real business-verification-style process with Safaricom, separate from the sandbox credentials already in use.
- **Blocked on**: you — this needs real business banking/paybill details tied to Hamzone Technologies.
- **Source**: `.env` comments; not yet written up in the roadmap doc (recorded here for the first time).

---

## AI providers — billing/config gaps (not registrations exactly, but external-account blockers)

### 13. Cerebras — `402 Payment Required` on every call
- **Status**: kept configured as a harmless no-op in the failover chain; needs a payment method added at cloud.cerebras.ai billing.
- **Evidence (2026-08-24, live query against real `AiProviderStat` rows, today's date)**: 502 calls, 0 successes, 502 failures — every single one the identical error: `"Payment required to access this resource. Visit your billing tab."` Confirmed still genuinely broken, not intermittent.
- **Next action**: add billing at cloud.cerebras.ai.
- **Source**: roadmap line 477; live-reconfirmed 2026-08-24.

### 14. Anthropic — `400 credit balance too low`
- **Status**: same shape as Cerebras — needs credits purchased on the Anthropic Console.
- **Evidence (2026-08-24, live query, today's date)**: 498 calls, 0 successes, 498 failures — every one: `"Your credit balance is too low to access the Anthropic API."` Confirmed still genuinely broken.
- **Next action**: top up credits at console.anthropic.com.
- **Source**: roadmap line 477; live-reconfirmed 2026-08-24.

### 15. `OPENAI_API_KEY`/`XAI_API_KEY` — corrected 2026-08-24, the real current state is simpler than previously written
- **Status**: the roadmap's original claim ("both show as set via `railway variables`, but the running container doesn't actually receive them") is **stale and no longer accurate**. Re-checked directly 2026-08-24: `railway variables` today shows **neither key present at all** (only their companion `_MODEL` vars, `XAI_MODEL`/etc., are set) — and local `.env` shows both as empty strings. There is no longer a "configured but not reaching the container" mismatch to diagnose; the real, current state is just "not configured," full stop — either the earlier finding was itself stale, or the keys were removed since. Either way, don't spend effort re-diagnosing a container/env mismatch that isn't the actual problem today.
- **Next action**: if you want OpenAI/xAI in the failover chain, set both keys fresh in Railway (`railway variables --set OPENAI_API_KEY=... --set XAI_API_KEY=...`) — a normal first-time setup, not a fix for a broken sync.
- **Source**: roadmap line 477 (original, now stale claim); corrected against live `railway variables` output and local `.env`, 2026-08-24.

---

## Future channels — registration/access research done, nothing started

### 16. X/Twitter
- **Status**: researched 2026-08-22, genuinely viable now that X moved to pay-per-use pricing, but **both directions of a conversation are billed** — receiving a DM costs $0.010, sending a reply costs $0.015, so a single round-trip is $0.025. Would need real two-sided cost-tracking built into `billing.ts` before shipping (not just a new channel adapter).
- **Next action**: none yet — not next in line ahead of what's already queued unless you want to reprioritize it.
- **Source**: roadmap lines 275-282.

### 17. LinkedIn
- **Status**: evaluated and found genuinely incompatible with P2Less's auto-reply model under LinkedIn's own policy (every message must tie to a non-automated member action with human edit-before-send) — not an access-tier problem, a fundamental model mismatch.
- **Next action**: none — would need a completely different human-drafts/AI-suggests interaction shape to even be policy-compliant. Not recommended to pursue as-is.
- **Source**: roadmap line 279.

### 18. TikTok
- **Status**: deferred, harder API access than the others; not researched in depth.
- **Source**: roadmap line 848.

---

## Quick-reference summary — sorted by effort to close

*Updated 2026-08-24 after a full live evidence re-check. Item #5 is done — dropped from this table. ⚠️ marks the new urgent finding.*

| # | Item | Effort | Blocked on |
|---|---|---|---|
| 9 | Telegram real bot token | **Minutes** — free, instant, self-service | Nothing |
| 10 | Resend Inbound setup | **~15 min** — self-service dashboard | Nothing |
| 6 | Messenger Tester invite | **Minutes**, once you tell me which FB account | Which Facebook account to invite |
| 13, 14 | Cerebras/Anthropic billing | **Minutes** — add a card | Nothing — confirmed still failing on every call today |
| 15 | OpenAI/xAI not configured | **Minutes** — first-time setup, not a fix | Nothing — corrected: no mismatch to diagnose, just unset |
| 8 | Phase 8c — add the missing Pages use case + request permissions | **~15-30 min**, real setup | Nothing — corrected: was never requested, not just unverified |
| 11 | Real SMS provider account | **~1 day** — provider signup + verification | Choosing/signing up with a provider |
| 2, 4 | WhatsApp spare number / Coexistence | **Depends on number availability** | You having a spare number |
| ⚠️ 1 | WhatsApp Business Verification (+ resolves the Access/Tech-Provider warning) | **Days-weeks** — Meta's own review | Your business identity docs — see the urgent finding above |
| 3, 7 | App Review (WhatsApp + Instagram) | **Days-weeks** — Meta's own review | Item #1 landing first (recommended) |
| 12 | M-Pesa Go-Live | **Days-weeks** — Safaricom's own review | Your business/banking details |
| 16-18 | X / LinkedIn / TikTok | **Not started, no urgency** | A future prioritization decision |
