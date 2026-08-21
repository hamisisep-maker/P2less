"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
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

type CardData = { setupIntentId: string; clientSecret: string; stripePublishableKey: string; orgName: string; industry: string; phoneNumber: string; adminName: string; adminEmail: string; useCases: string[]; channelsNeeded: string[] };
type OtpData = { challengeId: string; demoCode?: string; orgName: string; industry: string; phoneNumber: string; adminName: string; adminEmail: string; useCases: string[]; channelsNeeded: string[] };

// Registration reframe (roadmap doc "Registration reframe" section,
// 2026-08-21): honest about what's real today — no social media, no SMS
// conversations, no outbound-notification product yet. Context for
// personalization later, never a gate on what the org can actually do.
const USE_CASE_OPTIONS: { value: string; label: string }[] = [
  { value: "automate_conversations", label: "Automate WhatsApp conversations for my customers" },
  { value: "connect_systems", label: "Connect my existing software/systems" },
  { value: "developer_api", label: "I'm a developer — building on the API" },
  { value: "exploring", label: "Just exploring" },
];

// Registration reframe, continued: a DISTINCT question from use cases above
// — which channels the org's own customers actually use. WhatsApp and
// Messenger are genuinely live (Phase 8a shipped 2026-08-21); the rest are
// real demand signal for what to build next, labeled honestly as not yet
// available rather than implied to already work.
const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "messenger", label: "Facebook Messenger" },
  { value: "web_chat", label: "Our website (chat widget)" },
  { value: "sms_interested", label: "SMS (coming soon — let us know you need it)" },
  { value: "instagram_interested", label: "Instagram (coming soon — let us know you need it)" },
];

// Resume-on-refresh: see the "UX design — resuming an interrupted /onboard
// signup" note in docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md for the full
// rationale and what this deliberately does/doesn't cover.
const STORAGE_KEY = "p2less_onboard_progress";
type SavedProgress = ({ step: "otp" } & OtpData) | ({ step: "card" } & CardData);

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
    if (parsed?.step === "otp" || parsed?.step === "card") return parsed as SavedProgress;
    return null;
  } catch {
    return null;
  }
}

/** The card-collection sub-form. Split out because useStripe()/useElements()
 *  only work INSIDE an <Elements> provider. The visible button is type="button"
 *  — it runs Stripe's OWN client-side confirmCardSetup() first (raw card
 *  details never touch our server, staying out of PCI scope), and only on a
 *  real "succeeded" result does it trigger the actual form submission to
 *  confirmOnboardCardAction, which re-verifies server-side before trusting it. */
function CardStep({ data, error, confirmAction, pending, onStartOver }: { data: CardData; error?: string; confirmAction: (formData: FormData) => void; pending: boolean; onStartOver: () => void }) {
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
      {(data.useCases ?? []).map((uc) => <input key={uc} type="hidden" name="useCases" value={uc} />)}
      {(data.channelsNeeded ?? []).map((c) => <input key={c} type="hidden" name="channelsNeeded" value={c} />)}
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
      <button type="button" onClick={onStartOver} className="block w-full text-center text-[11px] text-faint underline hover:text-muted">Not you, or details wrong? Start over</button>
    </form>
  );
}

export function OnboardForm() {
  const [requestState, requestAction, requestPending] = useActionState(requestOnboardOtpAction, null as RequestOtpResult | null);
  const [confirmOtpState, confirmOtpAction, confirmOtpPending] = useActionState(confirmOnboardOtpAction, null as ConfirmOtpResult | null);
  const [confirmCardState, confirmCardAction, confirmCardPending] = useActionState(confirmOnboardCardAction, null as ConfirmCardResult | null);

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
  // conditional. Every hook below (useEffect, useMemo) is likewise called
  // unconditionally on every render; only their INTERNAL logic branches.
  // Rules of Hooks — hooks must never be called conditionally.

  const cardSuccess = confirmCardState && "ok" in confirmCardState ? confirmCardState : null;
  // confirmOtpState's "ok" branch is FinalizeOk ONLY when Stripe isn't
  // configured (finalizeOnboarding called directly, no "step" field) — when
  // Stripe IS configured, "ok:true" there means "move to the card step",
  // not a final success.
  const otpDirectSuccess = confirmOtpState && "ok" in confirmOtpState && !("step" in confirmOtpState) ? confirmOtpState : null;
  const finalSuccess = cardSuccess ?? otpDirectSuccess;

  // A failed card attempt returns here (confirmCardState); a fresh success
  // from the OTP step also lands here (confirmOtpState); a resumed session
  // (page refresh) falls back to sessionStorage. Live states always win over
  // the restored snapshot once any real action has actually fired.
  const cardFromError = confirmCardState && "step" in confirmCardState && confirmCardState.step === "card" ? confirmCardState : null;
  const cardFromOtpSuccess = confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "card" ? confirmOtpState : null;
  const cardFromStorage = !cardFromError && !cardFromOtpSuccess && restored?.step === "card" ? restored : null;
  const card = cardFromError ?? cardFromOtpSuccess ?? cardFromStorage;

  // Same precedence pattern as the card step: live error > live fresh success
  // > resumed sessionStorage snapshot. Only relevant if we're not already
  // past the OTP step (i.e. no card data yet).
  const otpError = confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "otp" ? confirmOtpState : null;
  const otpFresh = requestState && "step" in requestState ? requestState : null;
  const otpFromStorage = !otpError && !otpFresh && restored?.step === "otp" ? restored : null;
  const otp = !card ? (otpError ?? otpFresh ?? otpFromStorage) : null;
  const demoCode = otpFresh?.demoCode ?? otpFromStorage?.demoCode;

  // Persist whichever step is currently showing, and clear on real
  // completion — a genuinely finished signup shouldn't leave stale progress
  // behind for a future visit to this browser tab.
  useEffect(() => {
    if (finalSuccess) saveProgress(null);
    else if (card) saveProgress(card);
    else if (otp) saveProgress({ ...otp, demoCode });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finalSuccess, card, otp, demoCode]);

  const stripePromise = useMemo(() => {
    const key = (confirmOtpState && "step" in confirmOtpState && confirmOtpState.step === "card" && confirmOtpState.stripePublishableKey)
      || (confirmCardState && "step" in confirmCardState && confirmCardState.stripePublishableKey)
      || (restored?.step === "card" && restored.stripePublishableKey);
    return key ? loadStripe(key) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmOtpState, confirmCardState, restored]);

  function startOver() {
    saveProgress(null);
    // useActionState has no public "reset" — a full reload is the simplest
    // way to guarantee every step's state (and any in-progress OTP/card
    // data) is genuinely cleared, not just visually hidden.
    window.location.reload();
  }

  if (finalSuccess) return <SuccessScreen email={finalSuccess.email} password={finalSuccess.password} />;

  if (card && stripePromise) {
    return (
      <Card className="p-6">
        <Elements stripe={stripePromise}>
          <CardStep data={card} error={cardFromError?.error} confirmAction={confirmCardAction} pending={confirmCardPending} onStartOver={startOver} />
        </Elements>
      </Card>
    );
  }

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
          {(otp.useCases ?? []).map((uc) => <input key={uc} type="hidden" name="useCases" value={uc} />)}
          {(otp.channelsNeeded ?? []).map((c) => <input key={c} type="hidden" name="channelsNeeded" value={c} />)}
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
      <form action={requestAction} className="space-y-4">
        <div><label className={label}>Organization name</label><input name="orgName" required placeholder="Acme Clinic" className={field} /></div>
        <div>
          <label className={label}>What do you want P2Less to do? (pick any that apply)</label>
          <div className="mt-1 space-y-1.5">
            {USE_CASE_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="useCases" value={opt.value} className="rounded border-line" />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={label}>Which channels do your customers use? (pick any that apply)</label>
          <div className="mt-1 space-y-1.5">
            {CHANNEL_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="channelsNeeded" value={opt.value} className="rounded border-line" />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className={label}>Industry <span className="font-normal text-faint">(for templates &amp; context — doesn&apos;t limit what you can do)</span></label>
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
