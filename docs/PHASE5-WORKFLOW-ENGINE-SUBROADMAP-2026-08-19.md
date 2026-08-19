# Phase 5 Sub-Roadmap — Generalized Workflow Engine

The top-level roadmap (`docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md`) flagged Phase 5 as "the highest-effort, highest-risk phase... recommend treating it as its own sub-roadmap once Phases 1-4 are proven, not planned in detail yet." This is that sub-roadmap, written after actually reading `conversation.ts`'s state-machine code in full rather than guessing at its shape from the vision doc alone.

## What's actually there today (confirmed by direct reading, not assumed)

`conversation.ts` has **12 distinct `awaiting_*` conversation states**, each a hand-written `if (conversation.status === "awaiting_x" ...)` block: `awaiting_otp`, `awaiting_confirm`, `awaiting_resource_pick`, `awaiting_param`, `awaiting_identify`, `awaiting_cv_details`, `awaiting_order_quantity`, `awaiting_order_option`, `awaiting_order_fulfillment`, `awaiting_order_address`, `awaiting_order_payment_phone`, `awaiting_order_confirm`, plus `awaiting_delivery_feedback`. Every one of these has been independently hardened through real, live-reported bugs this project (documented in `p2less-platform.md` memory): the CONFIRM false-positive fix, the anti-nag/pushback fix, the order-flow quantity-assumption fix, the self-denial hallucination fix, and others.

**The genuinely shared shape**, confirmed across the two most-read handlers (`awaiting_confirm`, `awaiting_param`):
1. A universal escape hatch (cancel/stop/restart) — mostly caught by one shared block near the top of `handleInbound`, though some individual handlers ALSO carry their own narrower cancel regex (e.g. `awaiting_param`'s is an anchored exact-match `/^(cancel|stop|nevermind|never mind)$/i`, while the universal one is unanchored `\b`). **This inconsistency is real, not invented** — flagging it here rather than silently "fixing" it, since I don't know if it's deliberate (the anchored version might be intentionally stricter for a reason not visible from the code alone).
2. Is the message a plausible answer to what we're waiting for? (Varies per flow — a date/time extractor for `date`/`time` slots, a non-greeting/non-question check for `reason`, etc.)
3. If not plausible: is it a confident enough topic switch (`understand()` call, score compared to a threshold)? **The threshold itself deliberately differs per flow** — 0.55 in `awaiting_param`, 0.6 in `awaiting_confirm` — per the existing code's own reasoning: a slot-filling reroute is cheaper to get wrong than abandoning a pending payment confirmation. Any generalization MUST keep this as per-flow config, never a single global constant.
4. If not that either: push-back regex match, or a repeated stray message (`paramAsides`/`cAsides` counter) → abandon the flow (go `open`, answer via `smallTalk()`); a genuine first aside → answer it, then re-ask with a reminder.

## What Phase 5 actually built (this session)

- `evaluateWorkflowAsk()` (`src/lib/workflow-engine.ts`, new) — the pure decision function for step 2-4 above, taking the caller's already-computed booleans (plausibility, reroute-confidence, pushback, asides-so-far) and returning which of the four paths applies. Deliberately does NOT make the `understand()` call itself (async, needs DB/AI access) — same "pure function, caller resolves async facts" discipline as `capability-gate.ts`/`field-conflict.ts`. Tested against 7 cases derived directly from the real observed behavior of `awaiting_confirm`/`awaiting_param` (including that the default `maxAsides:2` reproduces the exact "abandon on the 2nd stray message" behavior both flows have today).
- This sub-roadmap document.

## What Phase 5 deliberately did NOT do, and why

**No existing `awaiting_*` handler was migrated to use `evaluateWorkflowAsk()`.** Two concrete blockers, found while doing this work, not assumed going in:

1. **Regression risk to hardened code.** These 12 handlers have a long, specific history of subtle live bugs (false-positive CONFIRM triggers, robotic re-nagging, silent quantity assumptions) each fixed individually through real user reports. A generalized migration touching all of them in one pass, without a comprehensive automated safety net, is exactly the kind of change that could reintroduce one of those exact bugs in a new form.
2. **The local test harness can't currently prove parity.** `scripts/test.ts` (a real 73-case E2E suite) was run against this session's dev server and 24 tests failed — but investigation traced every failure to the same root cause: every `Connector.baseUrl` in the seed data is hardcoded to `http://localhost:3000`, while this specific preview harness always runs the dev server on port 3001. Every failing test needed a real connector HTTP round-trip; every passing test didn't. This is a pre-existing environmental limitation of local testing in this harness, unrelated to this session's changes — but it means a full green run isn't available right now as the safety net a flow migration would need.

## Before attempting an actual migration (either fix, needed)

- **Fix the port mismatch** so `scripts/test.ts` can run fully green locally (either point connector `baseUrl`s at `${P2LESS_BASE_URL}` dynamically instead of a hardcoded port, or make the preview harness bind port 3000) — this restores a real regression safety net.
- **Or**, migrate one flow at a time against production with careful before/after live testing (the same rigor used for Phases 1-4's own verification), starting with the SIMPLEST, lowest-blast-radius flow as a pilot — `awaiting_resource_pick` is the best candidate: no payment/write side-effects, a small, self-contained handler, and its own bug history (the "which student do you mean" infinite-loop fix) is already well understood.

## Recommended migration order once unblocked (not started)

1. `awaiting_resource_pick` (pilot — smallest blast radius)
2. `awaiting_param` (slot-filling — the most common shape, exercises `evaluateWorkflowAsk()` fully)
3. `awaiting_confirm` (payment/write-adjacent — higher stakes, migrate only after 1-2 are proven live)
4. The 6 `awaiting_order_*` states (most complex — quantity/option/fulfillment/address/payment-phone/confirm chained together via `advanceOrder()`) — treat as its own follow-up slice, not bundled with 1-3
5. `awaiting_otp`/`awaiting_identify`/`awaiting_cv_details`/`awaiting_delivery_feedback` — each has enough unique, non-generic logic (OTP issuance, account linking, CV-text accumulation, driver feedback) that they may be better left as their own handlers permanently rather than forced into the generic shape; decide per-flow, not as a blanket rule.

This ordering, the port-mismatch fix, and the go/no-go on the pilot are the concrete next decisions — not made here, since they need either the test-harness fix or the user's explicit sign-off on live-testing against production given the regression risk.
