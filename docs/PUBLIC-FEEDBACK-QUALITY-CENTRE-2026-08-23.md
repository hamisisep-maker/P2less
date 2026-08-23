# P2Less — Public Bug-Hunting & AI Quality Feedback Programme

Vision document, proposed by the user 2026-08-23, refined against the actual current state of the codebase before being treated as a build plan. **Not started — vision + phased plan only**, same discipline as every other future-strategic item in this project (see the main roadmap doc's Phase 8b/candidate-channels sections for precedent).

## The core idea, and why it's right

Publish "found something wrong with P2Less? tell us" across the channels the assistant runs on, so real usage surfaces bugs and hallucinations faster than internal testing alone can. The user's own most important constraint on this idea is the correct one and should never be relaxed:

> **A report never automatically teaches the AI.** It always goes through a human review step first.

This isn't caution for its own sake — it's the same "never invent, always ground" discipline this entire session's bug-hunting has been enforcing on the AI itself, applied one layer up. If "P2Less told me my school has 500 students" got auto-ingested as a corrected fact, that would be a worse failure than the hallucination it was meant to fix. Every report must resolve through: **what was asked → what did P2Less answer → what data did it use → what should the answer have been → why did it fail** — before anything changes.

## Reality check: channel readiness, checked against this session's own work, not assumed

The proposal names 8 channels. Their actual state today is uneven — publishing an invitation on a channel that doesn't work yet is exactly the class of bug this whole session has spent rounds fixing on the widget, just pointed outward at the public instead of inward at the product.

| Channel | Real status | Fit for a public launch today? |
|---|---|---|
| **Website widget** | Live on the landing page, most battle-tested surface this session (28 FAQs, 11 bug-hunt rounds) | ✅ Ready |
| **WhatsApp** | Fully working, but self-service number onboarding (Phase 9) is still paused | ✅ Ready (existing numbers), self-signup not yet |
| **Facebook Messenger** | One real connected Page; inbound round-trip still unproven (blocked on a Meta dev-mode Tester-role restriction) | 🟡 Needs the Tester invite resolved first |
| **Telegram** | Fully built; never tested against a real `@BotFather` bot | 🟡 Needs a real bot + one real end-to-end test |
| **Email** | Fully built; Resend inbound isn't configured in production | 🟡 Needs `RESEND_INBOUND_DOMAIN`/`RESEND_WEBHOOK_SECRET` set |
| **Instagram** | Blocked on Meta App Review — not started | ❌ Not ready |
| **TikTok** | Not a channel — explicitly researched and deferred earlier this session | ❌ Doesn't exist |
| **X/Twitter** | Not a channel — researched, not built. If built, X bills **both directions** of a DM exchange (~$0.010 receive + ~$0.015 send ≈ $0.025/round trip) — open public traffic here has a real, uncapped cost, not just an engineering cost | ❌ Doesn't exist, and isn't free even once built |
| **SMS** | Wired up for OTP/notification delivery only — not a two-way conversational channel today | ❌ Not a channel to report through |

**Recommendation: launch on the 1-2 channels that are actually ready (widget, WhatsApp), expand per-channel only as each one is genuinely proven** — not a simultaneous 8-channel announcement. A channel earns its place on the public invitation the same way every fix this session earned a ship: live-verified first, announced after.

## A second real constraint: screenshots don't work everywhere yet

"Attach a screenshot" only works reliably on **WhatsApp** today — it's the only channel with file-attachment support wired up (confirmed via `currentChannelSupportsFiles()` in `tenant-context.ts`). Messenger/Telegram/Email/Widget are all text-only right now. On those channels a reporter can only describe the bug in words unless attachment handling gets built out for them too — a real, separate piece of scope, not assumed to already work.

## Don't build a parallel system — extend what already exists

P2Less already has a real ticket/incident workflow: `SupportTicket`, `TicketEvent`, an admin tickets/incidents workspace with status tracking, assignment, SLA deadlines, and audit logging. The "Quality & Feedback Centre" described in the proposal is structurally the same thing, scoped to AI-quality issues specifically. Building a second, disconnected reporting system would duplicate real, working infrastructure for no benefit.

**Recommended shape**, additive to what exists rather than replacing it:
- `SupportTicket` gains a `source` field (`"customer" | "public_bug_report"`) and a `category` field, nullable until triaged (`"ai_hallucination" | "knowledge_gap" | "bug" | "security" | "integration" | "user_misunderstanding" | null`).
- A new optional link from a ticket to the `Conversation`/`Message` it's actually about — **set by the reviewer manually** during triage (picking from that conversation's recent messages), not auto-detected. Automated fingerprint-matching (guessing which message a screenshot refers to) is a real inference problem of its own and risks mis-linking reports to the wrong exchange — not worth building until manual linking proves the workflow is valuable.
- The existing `AiRequestLog` (provider, model, cost, latency) is already keyed to a conversation/tenant — once a ticket is linked to the right message, the AI-execution trace (which provider/model answered, what FAQ or connector it drew from) is already sitting right there, no new logging needed.

This reuses real, already-audited infrastructure instead of inventing a parallel one, and keeps a public bug report inside the same review/assignment/SLA machinery your team already uses for everything else.

## Triage taxonomy — kept, it's genuinely good

The proposed categories map cleanly onto the distinctions this session's bug-hunting has drawn by hand all along:

| Category | What it means | What "fixed" actually looks like in this codebase |
|---|---|---|
| 🐛 Bug | A real code defect | A code fix (e.g. this session's `menuPrompt()` structural fix, the crawler's silent-failure fix) |
| 🤖 AI error / hallucination | The AI invented or misstated something | A prompt/instruction fix in `ai.ts` (e.g. the zero-capability topic-guessing fix), never a raw "add this fact and move on" |
| 📚 Knowledge gap | Correct info wasn't available to ground an answer | A new/corrected FAQ entry in `landing-content.ts` or the tenant's own FAQs |
| 🔐 Security issue | An authorization/access problem | A permissions/RBAC fix, always logged via the existing audit trail |
| 🔄 Integration issue | A connector returned wrong/stale data | A connector-config or external-system fix, not an AI-layer change at all |
| ❓ User misunderstanding | The system behaved correctly | No system change — documented and closed, same as this session's "investigated, not a bug" findings |

**Worth being precise about, since the phrase "help the AI learn" can be misread**: nothing in this system means retraining or fine-tuning a model. Every "AI error" fix this entire session has been either a system-prompt instruction change or a new grounded fact (FAQ) — that's what "fixed" means here, and the Quality Centre should make that explicit to reviewers rather than implying something more exotic is happening.

## Phased rollout

**Phase A — prove the workflow small, not public.** Extend `SupportTicket` with `source`/`category`. Build the triage dashboard view (grouped by category, same visual language as the existing incidents/tickets workspace). Pilot with a small trusted group (not a public blast) reporting through WhatsApp and the widget only — the two channels that are actually solid. Confirm the manual-linking and categorization workflow is fast enough to be worth using day-to-day before it's advertised anywhere.

**Phase B — public invitation, still just the two ready channels.** Publish "found a bug? tell us" on WhatsApp and the widget once Phase A proves out. This is the point where the public sees it for the first time.

**Phase C — expand per-channel as each one becomes real**, in this order, each gated on its own real milestone from the main roadmap: Messenger (once the Tester-invite/round-trip is proven), Telegram (once a real bot is connected), Email (once Resend inbound is configured). Each channel gets added to the public invitation only after it's independently verified working — not in a batch.

**Not planned, explicitly**: Instagram, TikTok, X/Twitter, SMS-as-a-conversational-channel. Revisit only if one of those channels gets built for its own real product reason first — a public bug-bounty invitation is never itself the reason to build a new channel.

## Open questions only the user can answer

1. **Review capacity.** This is presently a solo-founder operation. A public invitation across even 2 channels can generate real volume — is triaging reports a sustainable ongoing task right now, or should Phase A stay internal/invite-only for longer than one pilot round?
2. **Tenant scope.** Is this feedback programme about the P2Less *platform itself* (the self-tenant, the widget on the landing page) or about *every tenant's* deployment (Riverside, Hamzone, etc.)? These are different audiences and probably need different intake copy — the current proposal reads as platform-level, worth confirming.
3. **Data handling.** A screenshot or forwarded message from the public could contain another real person's private information (someone else's loan balance, a student's results). Worth a stated policy on how those get stored/reviewed/retained before this goes live, not after.
