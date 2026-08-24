# External registrations & provider-side setup — master checklist

**Purpose**: every item on this list is code-complete on P2Less's own side. What remains is a real action on an external provider's dashboard/review process, or a decision only the user can make (business identity, credentials, risk tolerance) — not more building. Created 2026-08-24 to consolidate everything scattered across `ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md`, `SYSTEM-DISCOVERY-2026-08-19.md`, and this session's chat history into one place, so nothing gets lost between sessions. Each item cites its source so the full reasoning/history can be pulled back up.

**How to use this doc**: work items in any order — none block each other except where noted. When an item is finished, mark it `✅ DONE <date>` in place (don't delete the row — keep the history) and, if it unblocks follow-on engineering work (e.g. Resend inbound → the email channel actually testable), say so in the chat so the next step gets picked up.

---

## Meta (WhatsApp, Messenger, Instagram) — one Business Manager, one App (`2450932552082438`, "Hamzone Technologies")

### 1. WhatsApp — Business Verification
- **Status**: not started. Deliberately deferred 2026-08-21 ("keep building around it for now").
- **Next action**: log into the Meta Business Manager (Hamzone Technologies portfolio) as an admin → complete "Verify your business" under the Tech Provider onboarding checklist. Needs real legal/business identity documents.
- **Blocked on**: you directly — Meta requires the actual Business Manager admin to do this, not driveable by browser automation on your behalf.
- **Unblocks**: WhatsApp App Review submission (#3 below), and possibly Coexistence mode (unconfirmed prerequisite, see #4).
- **Source**: roadmap §Phase 9, lines 663, 667.

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

### 5. WhatsApp — access-token expiry monitoring (a real, currently-open gap, not a registration task but adjacent)
- **Status**: no live token-validity probe exists. If a number's access token silently expires or is revoked, nothing detects it — `checkWhatsAppHealth()` only checks recent message activity, not token validity.
- **Next action**: worth confirming `WHATSAPP_ACCESS_TOKEN` is a genuine permanent System User token (Meta Business Settings → System Users → generate token, never expires unless revoked) rather than a 24-hour temporary one — if it's the latter, it will silently stop working. Not confirmed either way.
- **Blocked on**: nothing external — this is a real engineering gap (build a token-validity health check, mirroring Messenger's `social_token_health_sweep`) that can be picked up anytime.
- **Source**: `SYSTEM-DISCOVERY-2026-08-19.md` line 53.

### 6. Messenger — add the test sender as a Meta App Tester
- **Status**: NOT done, despite an earlier chat exchange that briefly said otherwise — corrected by you directly (2026-08-21). Paused on the "Add people to your app" → Roles → Tester screen, with "Tester" already selected as the role.
- **Next action**: search for and confirm the invite for the specific Facebook account that will send the test message; that account then needs to accept the invite; then resend a real message from that account to the connected Page ("Hamzone Technologies LTD").
- **Blocked on**: you (or whoever controls that Facebook account) completing the invite-accept step — I can't act on someone else's Facebook login.
- **Unblocks**: proving the full Messenger inbound round-trip (webhook → `handleInbound()` → grounded reply → Send API) end-to-end. Everything on P2Less's own side is already built, deployed, and correctly wired.
- **Source**: roadmap §Phase 8a, lines 214-215.

### 7. Instagram DMs — App Review (no dev-mode exception, unlike Messenger)
- **Status**: not started at all. `instagram_basic`/`instagram_manage_messages` both require App Review with zero dev-mode testing exception — genuinely different from Messenger's "Ready for testing" permissions.
- **Next action**: submit alongside WhatsApp's App Review (#3) if you want to batch it — video documentation can be shared/reused.
- **Blocked on**: a deliberate reordering decision already made — build and fully live-test Messenger first, submit Instagram in parallel.
- **Source**: roadmap §Phase 8a, line 197.

### 8. Phase 8c (auto-publish to Facebook/Instagram) — real permission re-verification
- **Status**: code built and structurally correct against Meta's documented contracts, but the live dashboard state for `pages_manage_posts`/`instagram_content_publish` hasn't been re-confirmed this session (the browser tool was disconnected when this phase was built).
- **Next action**: a real click-through — reconnect a Page, check the requested-permissions screen, attempt a real publish.
- **Blocked on**: nothing except doing the click-through; not a registration task, just unverified.
- **Source**: roadmap §Phase 8c, line 248.

---

## Telegram

### 9. A real `@BotFather`-created bot token
- **Status**: fully built, error path live-verified against a deliberately fake token. Never tested against a real token.
- **Next action**: create a bot via Telegram's `@BotFather` (free, instant, no approval process at all — the easiest external registration on this whole list), paste the token into `/dashboard/channels`, send it a real message.
- **Blocked on**: nothing — this is the single fastest item on this entire checklist to close.
- **Source**: roadmap §Phase 8d, line 261.

---

## Email (Resend)

### 10. Resend Inbound dashboard setup
- **Status**: not started (confirmed directly against both local `.env` and Railway production variables 2026-08-24 — `RESEND_INBOUND_DOMAIN`/`RESEND_WEBHOOK_SECRET` are unset in both).
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
- **Next action**: Safaricom's Daraja portal (developer.safaricom.co.ke) has a formal Go-Live application process to get a production shortcode/passkey/consumer-key+secret — this is a real business-verification-style process with Safaricom, separate from the sandbox credentials already in use.
- **Blocked on**: you — this needs real business banking/paybill details tied to Hamzone Technologies.
- **Source**: `.env` comments; not yet written up in the roadmap doc (recorded here for the first time).

---

## AI providers — billing/config gaps (not registrations exactly, but external-account blockers)

### 13. Cerebras — `402 Payment Required` on every call
- **Status**: kept configured as a harmless no-op in the failover chain; needs a payment method added at cloud.cerebras.ai billing.
- **Next action**: add billing at cloud.cerebras.ai.
- **Source**: roadmap line 477.

### 14. Anthropic — `400 credit balance too low`
- **Status**: same shape as Cerebras — needs credits purchased on the Anthropic Console.
- **Next action**: top up credits at console.anthropic.com.
- **Source**: roadmap line 477.

### 15. `OPENAI_API_KEY`/`XAI_API_KEY` — configured in Railway but not reaching the running container
- **Status**: a real, unresolved discrepancy — both show as set via `railway variables`, but direct container inspection confirmed they are NOT present in the actual running environment. Full key values aren't visible to diagnose further without your involvement.
- **Next action**: re-set both variables directly (delete and re-add, in case of a stale/corrupted entry) and confirm via a fresh deploy that they're actually present in the container.
- **Source**: roadmap line 477.

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

| # | Item | Effort | Blocked on |
|---|---|---|---|
| 9 | Telegram real bot token | **Minutes** — free, instant, self-service | Nothing |
| 10 | Resend Inbound setup | **~15 min** — self-service dashboard | Nothing |
| 6 | Messenger Tester invite | **Minutes**, once you're at a computer | Accepting the invite on the test FB account |
| 13, 14 | Cerebras/Anthropic billing | **Minutes** — add a card | Nothing |
| 15 | OpenAI/xAI Railway var mismatch | **Minutes** to re-set, but needs verifying | Nothing |
| 8 | Phase 8c permission re-check | **Minutes** — one click-through | Nothing |
| 11 | Real SMS provider account | **~1 day** — provider signup + verification | Choosing/signing up with a provider |
| 2, 4 | WhatsApp spare number / Coexistence | **Depends on number availability** | You having a spare number |
| 1 | WhatsApp Business Verification | **Days-weeks** — Meta's own review | Your business identity docs |
| 3, 7 | App Review (WhatsApp + Instagram) | **Days-weeks** — Meta's own review | Item #1 landing first (recommended) |
| 12 | M-Pesa Go-Live | **Days-weeks** — Safaricom's own review | Your business/banking details |
| 16-18 | X / LinkedIn / TikTok | **Not started, no urgency** | A future prioritization decision |
