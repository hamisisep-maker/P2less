"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { requestOnboardOtpAction, confirmOnboardOtpAction, type RequestOtpResult, type ConfirmOtpResult } from "@/lib/actions";
import { Card } from "@/components/ui";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

type OtpData = { challengeId: string; demoCode?: string; orgName: string; industry: string; adminPhone: string; adminName: string; adminEmail: string };

// Registration reframe (roadmap doc "Registration reframe" section,
// 2026-08-21, revised 2026-08-25): the "what do you want P2Less to do" /
// "which channels do your customers use" interest questions moved OUT of
// this form entirely — signup is identity + workspace creation only,
// nothing else. They belong to a separate, sequential, one-card-at-a-time
// post-signup experience (Phase 2 of this initiative, not yet built) —
// never a wall of options shown alongside the signup fields.

// Resume-on-refresh: see the "UX design — resuming an interrupted /onboard
// signup" note in docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md for the full
// rationale and what this deliberately does/doesn't cover.
const STORAGE_KEY = "p2less_onboard_progress";
type SavedProgress = { step: "otp" } & OtpData;

function saveProgress(p: SavedProgress | null) {
  try {
    if (p) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled/unavailable (private browsing, quota) — resuming
    // just won't work this time; never let this break the signup itself.
  }
}

function loadProgress(): SavedProgress | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.step === "otp") return parsed as SavedProgress;
    return null;
  } catch {
    return null;
  }
}

export function OnboardForm() {
  const [requestState, requestAction, requestPending] = useActionState(requestOnboardOtpAction, null as RequestOtpResult | null);
  const [confirmOtpState, confirmOtpAction, confirmOtpPending] = useActionState(confirmOnboardOtpAction, null as ConfirmOtpResult | null);

  // Resume-on-refresh: read once on mount (client-only — sessionStorage
  // doesn't exist during SSR, so this deliberately runs in an effect rather
  // than a lazy useState initializer, to avoid a hydration mismatch. Means
  // the very first paint always shows step 1 for a split second before
  // snapping to the resumed step, an acceptable tradeoff for correctness
  // over avoiding a one-frame flash.
  const [restored, setRestored] = useState<SavedProgress | null>(null);
  useEffect(() => { setRestored(loadProgress()); }, []);

  // All derived "what should we show" values are computed unconditionally,
  // every render, as plain values — only the actual JSX return is
  // conditional. Every hook below (useEffect) is likewise called
  // unconditionally on every render; only their INTERNAL logic branches.
  // Rules of Hooks — hooks must never be called conditionally.

  // No card step, 2026-08-25 — confirmOnboardOtpAction always either finalizes
  // (ok:true, no "step" field) or returns to the otp step with an error.
  const finalSuccess = confirmOtpState && "ok" in confirmOtpState ? confirmOtpState : null;

  const otpError = confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "otp" ? confirmOtpState : null;
  const otpFresh = requestState && "step" in requestState ? requestState : null;
  const otpFromStorage = !otpError && !otpFresh && restored ? restored : null;
  const otp = otpError ?? otpFresh ?? otpFromStorage;
  const demoCode = otpFresh?.demoCode ?? otpFromStorage?.demoCode;

  // Persist whichever step is currently showing, and clear on real
  // completion — a genuinely finished signup shouldn't leave stale progress
  // behind for a future visit to this browser tab.
  useEffect(() => {
    if (finalSuccess) saveProgress(null);
    else if (otp) saveProgress({ ...otp, step: "otp", demoCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalSuccess, otp, demoCode]);

  function startOver() {
    saveProgress(null);
    // useActionState has no public "reset" — a full reload is the simplest
    // way to guarantee every step's state is genuinely cleared, not just
    // visually hidden.
    window.location.reload();
  }

  if (finalSuccess) return <SuccessScreen email={finalSuccess.email} password={finalSuccess.password} />;

  if (otp) {
    return (
      <Card className="p-6">
        <form action={confirmOtpAction} className="space-y-4">
          <input type="hidden" name="orgName" value={otp.orgName} />
          <input type="hidden" name="industry" value={otp.industry} />
          <input type="hidden" name="adminPhone" value={otp.adminPhone} />
          <input type="hidden" name="adminName" value={otp.adminName} />
          <input type="hidden" name="adminEmail" value={otp.adminEmail} />
          <input type="hidden" name="challengeId" value={otp.challengeId} />
          <h2 className="text-lg font-semibold">Verify your phone number</h2>
          <p className="text-sm text-muted">We sent a 6-digit code to <span className="font-mono">{otp.adminPhone}</span> to confirm it&apos;s really you. Enter it below.</p>
          {demoCode && (
            <div className="rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
              Demo only. No SMS provider is configured yet, so nothing was actually texted. Your code is <span className="font-mono font-semibold">{demoCode}</span>.
            </div>
          )}
          <div><label className={label}>6-digit code</label><input name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} className={field} /></div>
          {otpError?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{otpError.error}</div>}
          <button type="submit" disabled={confirmOtpPending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
            {confirmOtpPending ? "Verifying…" : "Verify & create workspace"}
          </button>
          <p className="text-center text-[11px] text-faint">Code expires in 5 minutes.</p>
          <button type="button" onClick={startOver} className="block w-full text-center text-[11px] text-faint underline hover:text-muted">Not you, or details wrong? Start over</button>
        </form>
      </Card>
    );
  }

  const formError = (requestState && "error" in requestState && requestState.error)
    || (confirmOtpState && "error" in confirmOtpState && confirmOtpState.error)
    || undefined;

  return (
    <Card className="p-6">
      <form action={requestAction} className="space-y-5">
        <div><label className={label}>Organization name</label><input name="orgName" required placeholder="Sunrise Bakery" className={field} /></div>

        <div>
          <label className={label}>Industry <span className="font-normal text-faint">(for templates &amp; analytics)</span></label>
          <select name="industry" className={field} defaultValue="business">
            <option value="school">School</option><option value="hospital">Hospital</option>
            <option value="business">Business</option><option value="sacco">SACCO</option>
            <option value="ngo">NGO</option><option value="government">Government</option>
          </select>
        </div>

        <div><label className={label}>Your phone number</label><input name="adminPhone" required placeholder="+254712345678" className={field} /><p className="mt-1 text-[11px] text-faint">We&apos;ll text a code to confirm it&apos;s really you.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Your name</label><input name="adminName" required placeholder="Amina Yusuf" className={field} /></div>
          <div><label className={label}>Your email</label><input name="adminEmail" type="email" required placeholder="amina@sunrisebakery.co" className={field} /></div>
        </div>
        {formError && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{formError}</div>}
        <button type="submit" disabled={requestPending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
          {requestPending ? "Sending code…" : "Create my workspace"}
        </button>
      </form>
    </Card>
  );
}

function SuccessScreen({ email, password }: { email: string; password: string }) {
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">Your P2Less workspace is ready</h2>
      <p className="text-sm text-muted">Save these credentials to sign in.</p>
      <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
        <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{email}</span></div>
        <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{password}</span></div>
      </div>
      <div className="rounded-xl border border-line-soft bg-surface-2 p-3 text-xs text-muted">
        Connect WhatsApp or another channel anytime from your dashboard.
      </div>
      <Link href="/login" className="inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">Sign in</Link>
    </Card>
  );
}
