# P2Less — UX Consistency Standards & Client-Readiness Audit

Triggered by a real gap the user found testing Falem Sacco: saving FAQs gives no clear confirmation. Turned into a full audit of every save/edit/delete flow in the dashboard and admin apps before this goes to real clients.

## The core rule (keep this, it's exactly right)

> If the system changes something, tell the user.
> If the system does not change something, tell the user.
> If the system is processing something, show the user.
> If the system cannot complete something, explain it and tell the user what to do next.

Everything below is in service of that rule, grounded in what the codebase actually has today — not a generic checklist.

## The single most important correction to the original ask

**A toast system already exists.** `sonner` is a dependency, mounted globally in `src/app/layout.tsx`, and **28 files already call `toast.success()`/`toast.error()`** — most of `src/app/admin/**`, and about half of `dashboard/channels` and `dashboard/billing`. This is not a "build a notification system" task. It's a "finish rolling out the pattern that already exists" task — a much smaller, much lower-risk piece of work than the original 34-section document implied.

**A confirmation-dialog component already exists too.** `src/components/admin/reason-action.tsx` (`ReasonAction`) wraps a destructive action with a required typed reason + toast on completion — used consistently for Suspend tenant, Disable integration, Revoke session, Ignore transaction, Reset AI primary. It's the exact pattern section 3 of the original document asked for. It just never made it into the tenant-facing dashboard — only `src/app/admin/**` uses it.

So the real work here is **consistency and reuse**, not new infrastructure.

## What's actually broken — verified against real code, most severe first

### 1. Three real "silent success" bugs, same pattern copy-pasted three times
`dashboard/products/products-editor.tsx`, `dashboard/delivery/delivery-editor.tsx`, `dashboard/drivers/drivers-editor.tsx` — all three:
- On successful save, the form just closes (`setEditing(null)`). No banner, no toast, nothing. The only evidence anything happened is the list silently re-rendering with new data — easy to miss entirely.
- Deactivate/Reactivate is a bare `<form action={toggleXActiveAction}>` with **zero feedback of any kind**: no confirmation before flipping an active record inactive, no pending state, no success/error signal, and no visible failure if a permission check silently blocks it server-side.

This is precisely the "silent failure" the standards document explicitly says must never happen (§9, §29) — and it's live in production today, in three places, from what looks like one component being copied twice.

### 2. Two confirmed cases of a toast lying about success
- `admin/ai/provider-card.tsx` fires `toast.success(...)` **unconditionally**, without checking the server action's actual return value — if the save fails server-side, the UI still claims success.
- `admin/billing/automation/rules-table.tsx` does the same — awaits the action but fires the success toast without checking the result for an error.
- `admin/billing/pricing-form.tsx`'s "Reset defaults" button chains a raw promise with no `.catch()` — a rejected request is silently swallowed.

These are exactly the anti-pattern the standards document warns against in §9 ("The system should not display a success notification when the backend operation failed") — not hypothetical, three real live instances of it.

### 3. Widget key Deactivate — the highest client-risk gap
`dashboard/widget/widget-key-row.tsx`: both "Save domains" and "Deactivate" are bare form actions with no confirmation, no pending indicator, no feedback. Deactivating kills a **live, publicly embedded** widget key — a client could disable their own site's chat bubble with one misclick and have no idea what happened or how to undo it.

### 4. Zero dirty-state / "no changes" detection anywhere
Confirmed by grep — `isDirty`, `hasChanges`, `unsaved`, `dirty` appear nowhere in the codebase. Every save button always submits and always reports success (or silently doesn't, per #1), whether or not anything actually changed. This matches the original complaint exactly and is systemic, not FAQ-specific.

### 5. FAQs itself
Uses `useActionState` + an inline green/red banner — internally consistent, correctly shows success and error, but it's the *inconsistent* pattern relative to the rest of the app (28 other files use a toast instead), and has no dirty-check (see #4).

## What's already good, worth calling out so it doesn't get "fixed" unnecessarily
- `ticket-workspace.tsx`'s shared `run()` helper is a genuinely good pattern: checks the result, shows a distinct **partial-success** state where it applies (e.g. "Response saved, but not delivered" via `toast.warning`, distinct from full success). Worth reusing as the template for other flows, not replacing.
- `admin/integrations/check-now-button.tsx` dynamically picks `toast.success`/`toast.error` based on the actual check result — a good example of not assuming success.
- AI provider failover is intentionally silent to the end user (by design — a provider switch shouldn't alarm anyone), while still being logged for admins via `aiFailoverAudit`. This already satisfies what the original document's §22 asked for; no change needed there.
- Widget key creation, API key creation, and webhook secret creation all correctly use a persistent inline banner (not an auto-dismissing toast) to show a reveal-once secret — the right call, since a toast that vanishes in 4 seconds would lose the only copy of a credential.

## Phase 1 — ✅ SHIPPED 2026-08-23 (commit `5a000fb`, Railway `c6cce5b9`)

All four confirmed bugs from the audit fixed, live-verified in a real browser session:
- Products/Delivery zones/Drivers editors now show a real `toast.success("… added" | "… updated")` on save — previously silent.
- Their Deactivate/Reactivate toggles moved to a new shared `src/components/toggle-active-button.tsx` — confirms before deactivating (the destructive direction only, not reactivating), shows a toast either way, and the three `toggleXActiveAction`s in `actions.ts` now return a real `{ ok, active } | { error }` instead of `void` so the UI can actually tell success from failure.
- `admin/ai/provider-card.tsx` and `admin/billing/automation/rules-table.tsx` no longer fire a success toast without checking the actual result first.
- `admin/billing/pricing-form.tsx`'s "Reset defaults" button no longer has an unhandled promise rejection.

Live-verified, not just typechecked: reproduced the exact save/toggle flows against a real tenant (Kilimani Retail), caught the real `"Product updated"` toast rendering in the DOM via a polling script (two earlier attempts missed it purely on tool round-trip timing, not a real bug — confirmed by checking the underlying DB write succeeded both times), confirmed the `confirm()` dialog fires with the intended message, confirmed zero console errors across all three affected pages, confirmed all test data and temporarily-granted permissions were fully reverted afterward.

## Phase 2 — ✅ SHIPPED 2026-08-23 (commit `1144967`, Railway `8b64bfca`)

The highest client-risk gap from the audit: `dashboard/widget/widget-key-row.tsx`'s "Save domains" and "Deactivate" were bare form actions with zero feedback — a client could kill their own live, publicly embedded widget with one misclick. Rewrote it with `useTransition`-driven handlers: Save domains now toasts success/error; Deactivate now confirms first with an honest message (there's no self-service reactivate for that exact key — the row simply stops rendering once deactivated). Both server actions (`updateWidgetOriginsAction`, `deactivateWidgetKeyAction`) now return a real result instead of `void`.

Live-verified all three paths in a real browser session against a real test tenant: Save domains persisted with a toast caught in the DOM; Deactivate + cancel correctly left the key untouched (confirmed via DB); Deactivate + confirm correctly flipped it inactive (confirmed via DB) and the page correctly re-rendered showing the "deactivated" badge with the row's controls gone.

## Recommended path — phased, not all 34 sections at once

Trying to apply the full original standards document everywhere at once is realistically months of work across 20+ modules. Here's a sequence that fixes the real, live problems first and treats the rest as deliberate follow-on phases:

**Phase 1 — ✅ SHIPPED, see above — fix the confirmed bugs (small, safe, no new patterns needed):**
Products/Delivery/Drivers silent success → add `toast.success`, matching the 28 files that already do this correctly. Same three files' Deactivate/Reactivate → wrap in the existing `ReasonAction` pattern (or a lighter dashboard-side variant) instead of a bare form. Fix the two false-success toasts and the unhandled promise — these are just bugs, unrelated to any bigger design decision.

**Phase 2 — ✅ SHIPPED, see above — the highest-risk gap:**
Widget key Deactivate gets a real confirmation step + toast feedback. This is the one place a client could genuinely hurt themselves with one misclick.

**Phase 3 — consistency pass:**
Bring FAQs onto the same toast pattern as everywhere else (or formally decide inline-banner is the intended pattern for form-heavy editors and standardize *that* — worth a real decision, not just copying whichever is more common). Generalize `ReasonAction` (or a lighter variant) for use in the tenant dashboard, not just admin.

**Phase 4 — the "no changes made" detection:**
Build one reusable dirty-check helper, pilot it on FAQs (the case that started this), then extend to Products/Delivery/Drivers.

**Phase 5 — deferred, real but lower priority for a first client demo:**
Unsaved-changes navigation warnings (genuinely fiddly with Next.js client-side routing, needs its own implementation plan), granular WhatsApp delivery-state UI, and anything referencing modules not yet confirmed to exist in their described form (Customer 360, Reports, Documents) — revisit once those modules are real and once Phase 1-4 prove out the pattern.

## Test matrix (kept from the original document — this part holds up well as-is)

| Test | Expected result |
|---|---|
| Create | Success feedback |
| Edit with changes | Updated feedback |
| Edit without changes | "No changes were made" |
| Delete/deactivate | Confirmation + success |
| Validation error | Clear field-level feedback |
| Permission denied | Clear permission message |
| Server failure | Error feedback, never a false success |
| Double click | No duplicate operation |
| Slow request | Loading state |
