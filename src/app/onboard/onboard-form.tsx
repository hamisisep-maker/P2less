"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import {
  requestOnboardOtpAction, confirmOnboardOtpAction, confirmOnboardCardAction,
  type RequestOtpResult, type ConfirmOtpResult, type ConfirmCardResult,
} from "@/lib/actions";
import { Card } from "@/components/ui";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

type CardData = { setupIntentId: string; clientSecret: string; stripePublishableKey: string; orgName: string; industry: string; phoneNumber: string; adminName: string; adminEmail: string };

/** The card-collection sub-form. Split out because useStripe()/useElements()
 *  only work INSIDE an <Elements> provider. The visible button is type="button"
 *  — it runs Stripe's OWN client-side confirmCardSetup() first (raw card
 *  details never touch our server, staying out of PCI scope), and only on a
 *  real "succeeded" result does it trigger the actual form submission to
 *  confirmOnboardCardAction, which re-verifies server-side before trusting it. */
function CardStep({ data, error, confirmAction, pending }: { data: CardData; error?: string; confirmAction: (formData: FormData) => void; pending: boolean }) {
  const stripe = useStripe();
  const elements = useElements();
  const formRef = useRef<HTMLFormElement>(null);
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  async function handleVerify() {
    if (!stripe || !elements) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;
    setLocalError(undefined);
    setConfirming(true);
    const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(data.clientSecret, {
      payment_method: { card: cardElement, billing_details: { name: data.adminName, email: data.adminEmail } },
    });
    if (stripeError) {
      setLocalError(stripeError.message ?? "Card verification failed. Please check your card details and try again.");
      setConfirming(false);
      return;
    }
    if (setupIntent?.status === "succeeded") {
      formRef.current?.requestSubmit();
    } else {
      setLocalError("Card verification wasn't completed. Please try again.");
      setConfirming(false);
    }
  }

  const busy = confirming || pending;

  return (
    <form ref={formRef} action={confirmAction} className="space-y-4">
      <input type="hidden" name="orgName" value={data.orgName} />
      <input type="hidden" name="industry" value={data.industry} />
      <input type="hidden" name="phoneNumber" value={data.phoneNumber} />
      <input type="hidden" name="adminName" value={data.adminName} />
      <input type="hidden" name="adminEmail" value={data.adminEmail} />
      <input type="hidden" name="setupIntentId" value={data.setupIntentId} />
      <h2 className="text-lg font-semibold">Verify a card</h2>
      <p className="text-sm text-muted">Last step — we verify a real card is on file before connecting your number. <b>This never charges anything</b>, it&apos;s a $0 verification only.</p>
      <div>
        <label className={label}>Card details</label>
        <div className="mt-1 rounded-lg border border-line bg-surface px-3 py-2.5">
          <CardElement options={{ style: { base: { fontSize: "14px" } } }} />
        </div>
      </div>
      {(localError || error) && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{localError || error}</div>}
      <button type="button" onClick={handleVerify} disabled={busy || !stripe} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
        {busy ? "Verifying card…" : "Verify card & create workspace"}
      </button>
      <p className="text-center text-[11px] text-faint">Secured by Stripe — your card details never touch P2Less servers.</p>
    </form>
  );
}

export function OnboardForm() {
  const [requestState, requestAction, requestPending] = useActionState(requestOnboardOtpAction, null as RequestOtpResult | null);
  const [confirmOtpState, confirmOtpAction, confirmOtpPending] = useActionState(confirmOnboardOtpAction, null as ConfirmOtpResult | null);
  const [confirmCardState, confirmCardAction, confirmCardPending] = useActionState(confirmOnboardCardAction, null as ConfirmCardResult | null);

  const stripePromise = useMemo(() => {
    const key = (confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "card" && confirmOtpState.stripePublishableKey)
      || (confirmCardState && "step" in confirmCardState && confirmCardState.stripePublishableKey);
    return key ? loadStripe(key) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOtpState, confirmCardState]);

  if (confirmCardState && "ok" in confirmCardState) return <SuccessScreen email={confirmCardState.email} password={confirmCardState.password} />;
  // confirmOtpState's "ok" branch is FinalizeOk ONLY when Stripe isn't
  // configured (finalizeOnboarding called directly, no "step" field) — when
  // Stripe IS configured, "ok:true" there means "move to the card step",
  // handled separately below, not a final success.
  if (confirmOtpState && "ok" in confirmOtpState && !("step" in confirmOtpState)) {
    return <SuccessScreen email={confirmOtpState.email} password={confirmOtpState.password} />;
  }

  // A failed card attempt returns here (confirmCardState); a fresh success
  // from the OTP step also lands here (confirmOtpState). The card-error
  // state wins when present since it reflects the most recent attempt.
  const cardFromError = confirmCardState && "step" in confirmCardState && confirmCardState.step === "card" ? confirmCardState : null;
  const cardFromOtpSuccess = confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "card" ? confirmOtpState : null;
  const card = cardFromError ?? cardFromOtpSuccess;

  if (card && stripePromise) {
    return (
      <Card className="p-6">
        <Elements stripe={stripePromise}>
          <CardStep data={card} error={cardFromError?.error} confirmAction={confirmCardAction} pending={confirmCardPending} />
        </Elements>
      </Card>
    );
  }

  // A failed OTP attempt returns to this step (with an error) via
  // confirmOtpState; a fresh step-1 success also lands here via requestState.
  const otpError = confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "otp" ? confirmOtpState : null;
  const otpFresh = requestState && "step" in requestState ? requestState : null;
  const otp = otpError ?? otpFresh;
  const demoCode = otpFresh?.demoCode;

  if (otp) {
    return (
      <Card className="p-6">
        <form action={confirmOtpAction} className="space-y-4">
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
          {otpError?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{otpError.error}</div>}
          <button type="submit" disabled={confirmOtpPending} className="w-full rounded-xl bg-accent py-2.5 font-medium text-white hover:bg-accent-ink disabled:opacity-60">
            {confirmOtpPending ? "Verifying…" : "Verify & continue"}
          </button>
          <p className="text-center text-[11px] text-faint">Code expires in 5 minutes.</p>
        </form>
      </Card>
    );
  }

  const formError = (requestState && "error" in requestState && requestState.error)
    || (confirmOtpState && "error" in confirmOtpState && confirmOtpState.error)
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

function SuccessScreen({ email, password }: { email: string; password: string }) {
  return (
    <Card className="space-y-4 p-6">
      <div className="text-2xl">🎉</div>
      <h2 className="text-lg font-semibold">Your P2Less workspace is ready</h2>
      <p className="text-sm text-muted">Sign in with the one-time credentials below (save them now).</p>
      <div className="space-y-2 rounded-xl bg-surface-2 p-4 text-sm">
        <div className="flex justify-between"><span className="text-muted">Email</span><span className="font-mono">{email}</span></div>
        <div className="flex justify-between"><span className="text-muted">Password</span><span className="font-mono">{password}</span></div>
      </div>
      <div className="rounded-xl border border-amber/30 bg-amber-soft p-3 text-xs text-amber">
        Your number is <b>pending</b> — the next step is the Meta Embedded Signup confirmation
        (one popup), after which it goes live. In this demo that step is stubbed.
      </div>
      <Link href="/login" className="inline-block rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-ink">Go to sign in →</Link>
    </Card>
  );
}
