"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestOnboardOtpAction, confirmOnboardOtpAction, type RequestOtpResult, type ConfirmOtpResult } from "@/lib/actions";
import { Card } from "@/components/ui";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

export function OnboardForm() {
  const [requestState, requestAction, requestPending] = useActionState(requestOnboardOtpAction, null as RequestOtpResult | null);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmOnboardOtpAction, null as ConfirmOtpResult | null);

  if (confirmState && "ok" in confirmState) {
    return (
      <Card className="space-y-4 p-6">
        <div className="text-2xl">🎉</div>
        <h2 className="text-lg font-semibold">Your P2Less workspace is ready</h2>
        <p className="text-sm text-muted">Sign in with the one-time credentials below (save them now).</p>
        <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{confirmState.email}</span></div>
          <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{confirmState.password}</span></div>
        </div>
        <div className="rounded-xl border border-amber/30 bg-amber-soft p-3 text-xs text-amber">
          Your number is <b>pending</b> — the next step is the Meta Embedded Signup confirmation
          (one popup), after which it goes live. In this demo that step is stubbed.
        </div>
        <Link href="/login" className="inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">Go to sign in →</Link>
      </Card>
    );
  }

  // A failed verification attempt returns to the OTP step (with an error) via
  // confirmState; a fresh step-1 success also lands here via requestState.
  // confirmState wins when present since it reflects the most recent attempt.
  const otp = confirmState && "step" in confirmState ? confirmState
    : requestState && "step" in requestState ? requestState
    : null;
  const otpError = confirmState && "step" in confirmState ? confirmState.error : undefined;
  const demoCode = requestState && "step" in requestState ? requestState.demoCode : undefined;

  if (otp) {
    return (
      <Card className="p-6">
        <form action={confirmAction} className="space-y-4">
          <input type="hidden" name="orgName" value={otp.orgName} />
          <input type="hidden" name="industry" value={otp.industry} />
          <input type="hidden" name="phoneNumber" value={otp.phoneNumber} />
          <input type="hidden" name="adminName" value={otp.adminName} />
          <input type="hidden" name="adminEmail" value={otp.adminEmail} />
          <input type="hidden" name="challengeId" value={otp.challengeId} />
          <h2 className="text-lg font-semibold">Verify your phone number</h2>
          <p className="text-sm text-muted">We sent a 6-digit code to <span className="font-mono">{otp.phoneNumber}</span> to confirm you actually control this number before we connect it. Enter it below.</p>
          {demoCode && (
            <div className="rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-xs text-amber">
              Demo only — no SMS provider is configured yet, so nothing was actually texted. Your code is <span className="font-mono font-semibold">{demoCode}</span>.
            </div>
          )}
          <div><label className={label}>6-digit code</label><input name="code" required inputMode="numeric" autoComplete="one-time-code" placeholder="123456" maxLength={6} className={field} /></div>
          {otpError && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{otpError}</div>}
          <button type="submit" disabled={confirmPending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
            {confirmPending ? "Verifying…" : "Verify & create workspace"}
          </button>
          <p className="text-center text-[11px] text-faint">Code expires in 5 minutes.</p>
        </form>
      </Card>
    );
  }

  const formError = (requestState && "error" in requestState && requestState.error)
    || (confirmState && "error" in confirmState && confirmState.error)
    || undefined;

  return (
    <Card className="p-6">
      <form action={requestAction} className="space-y-4">
        <div><label className={label}>Organization name</label><input name="orgName" required placeholder="Acme Clinic" className={field} /></div>
        <div>
          <label className={label}>Industry</label>
          <select name="industry" className={field} defaultValue="business">
            <option value="school">School</option><option value="hospital">Hospital</option>
            <option value="business">Business</option><option value="sacco">SACCO</option>
            <option value="ngo">NGO</option><option value="government">Government</option>
          </select>
        </div>
        <div><label className={label}>WhatsApp number to connect</label><input name="phoneNumber" required placeholder="+254712345678" className={field} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Your name</label><input name="adminName" required placeholder="Jane Doe" className={field} /></div>
          <div><label className={label}>Your email</label><input name="adminEmail" type="email" required placeholder="jane@acme.co" className={field} /></div>
        </div>
        {formError && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{formError}</div>}
        <button type="submit" disabled={requestPending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
          {requestPending ? "Sending code…" : "Connect with Meta (Embedded Signup)"}
        </button>
        <p className="text-center text-[11px] text-faint">By continuing you authorize P2Less to register this number with WhatsApp on your behalf. We&apos;ll text a verification code to confirm it&apos;s yours first.</p>
      </form>
    </Card>
  );
}
