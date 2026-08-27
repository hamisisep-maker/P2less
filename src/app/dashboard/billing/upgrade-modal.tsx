"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/modal";
import { createUpgradeInvoiceAction, initiateInvoiceStkPaymentAction, getPaybillInfo, getCardInfo, initiateInvoiceCardPaymentAction } from "@/lib/invoicing";

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;

// Replaces upgrade-plan-button.tsx, 2026-08-25 — that component submitted a
// form straight to upgradeSubscriptionPlanAction, which activated the plan
// on click with NO payment step at all (see docs/GAP-REGISTER item 6).
// "Upgrade" now only ever opens this modal; no plan change happens until a
// verified payment settles the invoice server-side.

type InvoiceView = {
  id: string; invoiceNumber: string; status: string;
  fromPlanValueKes: number; remainingValueKes: number; toPlanPriceKes: number; payableKes: number;
  messageTopupMessages: number; messageTopupKes: number;
  usedDays: number; remainingDays: number; daysInCycle: number;
  fromPlan: { name: string } | null; toPlan: { name: string; limits: unknown };
};

type Step = "loading" | "choose_plan" | "extra_messages" | "breakdown" | "phone" | "waiting" | "paybill" | "paybill_partial" | "paybill_pending" | "card_redirecting" | "paid" | "failed" | "error";
type PlanOption = { id: string; name: string; priceMonthly: number };

const TOPUP_STEP_MESSAGES = 100; // slider granularity — round numbers, not arbitrary counts
const TOPUP_MAX_MESSAGES = 5000;

// `exhausted` — 2026-08-27, direct request: when a trial's free allowance or
// a paid plan's real KES balance runs out, don't just quietly stop replying
// and wait for someone to notice the notification bell — open straight to
// this same real payment flow (no separate flow to build/maintain), with an
// attention-grabbing reason banner explaining exactly why they're here.
// `planOptions` is deliberately every real upgrade tier, not just the
// nearest one — real feedback 2026-08-27: an earlier version only ever
// offered the single cheapest plan, which read as forcing one choice on
// someone rather than letting them pick. With 2+ options this opens on a
// real "choose a plan" step first; with exactly one, it skips straight to
// the top-up step (nothing to choose between on the plan itself). Every
// exhausted flow then always passes through a real "top up messages" slider
// before the invoice is created — direct concern, 2026-08-27: paying for a
// plan alone doesn't guarantee enough message balance to actually resume
// replying, so this lets the tenant bundle a real top-up (priced at the
// exact same per-message rate the balance is normally debited at) into the
// same payment. `pricePerMessageKes` is needed for a live, un-throttled
// slider preview without a server round-trip per drag tick — still only
// ever a preview: the real amount is computed and re-verified server-side
// in createUpgradeInvoiceAction regardless of what this shows. `hideTrigger`
// skips rendering the manual "Upgrade" row entirely for this case — the
// dashboard usage card already has its own prominent "Top up now" button.
export function UpgradeModal({
  planId, planName, priceMonthly, exhausted, hideTrigger,
}: {
  planId: string; planName: string; priceMonthly: number;
  exhausted?: { title: string; detail: string; planOptions: PlanOption[]; pricePerMessageKes: number } | null;
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activePlan, setActivePlan] = useState<PlanOption>({ id: planId, name: planName, priceMonthly });
  const [extraMessages, setExtraMessages] = useState(0);

  useEffect(() => {
    // Only ever auto-opens once, on mount — never re-forces itself back open
    // after someone closes it, even if the exhausted prop is still truthy on
    // a later re-render (e.g. a background refresh before they've paid).
    if (exhausted) {
      setOpen(true);
      if (exhausted.planOptions.length > 1) setStep("choose_plan");
      else {
        setActivePlan(exhausted.planOptions[0] ?? activePlan);
        setStep("extra_messages");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [step, setStep] = useState<Step>("loading");
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  const [paybill, setPaybill] = useState<{ available: boolean; shortcode?: string }>({ available: false });
  const [cardAvailable, setCardAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(0);

  const start = async (plan: PlanOption = activePlan, topupMessages = 0) => {
    setActivePlan(plan);
    setOpen(true);
    setStep("loading");
    setErrorMsg(null);
    const [result, pb, card] = await Promise.all([createUpgradeInvoiceAction(plan.id, topupMessages), getPaybillInfo(), getCardInfo()]);
    setPaybill(pb);
    setCardAvailable(card.available);
    if ("error" in result) {
      setStep("error");
      setErrorMsg(result.error);
      return;
    }
    setInvoice(result.invoice as InvoiceView);
    setStep(result.invoice.status === "paid" ? "paid" : "breakdown");
  };

  const close = () => {
    setOpen(false);
    if (step === "paid") router.refresh();
  };

  const payWithStk = async () => {
    if (!invoice) return;
    if (phone.trim().length < 9) { setErrorMsg("Enter a valid M-Pesa phone number."); return; }
    setErrorMsg(null);
    setStep("waiting");
    const result = await initiateInvoiceStkPaymentAction(invoice.id, phone.trim());
    if ("error" in result) {
      setStep("phone");
      setErrorMsg(result.error);
      return;
    }
    if (result.mock) {
      setStep("paid");
      router.refresh();
      return;
    }
    if (!result.ref) { setStep("phone"); setErrorMsg("Could not start payment — please try again."); return; }
    setRef(result.ref);
    // Same 3s-interval/90s-timeout polling pattern already proven in pay-button.tsx.
    const started = Date.now();
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/payments/status?ref=${encodeURIComponent(result.ref!)}`);
        const d = (await r.json()) as { status?: string };
        if (d.status === "paid") { setStep("paid"); clearInterval(t); router.refresh(); }
        else if (d.status === "failed") { setStep("failed"); clearInterval(t); }
      } catch { /* keep polling */ }
      if (Date.now() - started > 90_000) { clearInterval(t); setStep("phone"); setErrorMsg("Still waiting on confirmation — check your phone, or try again."); }
    }, 3000);
  };

  const startPaybill = () => {
    if (!invoice) return;
    setStep("paybill");
    // Paybill is out-of-band — no "initiate" step, only the invoiceId to
    // poll by. A partial payment must never be shown as "upgraded" (review
    // requirement) — the invoice status endpoint's own paidSoFarKes is the
    // only source of truth, never inferred from "a payment was detected".
    const started = Date.now();
    const t = setInterval(async () => {
      try {
        const r = await fetch(`/api/invoices/status?id=${encodeURIComponent(invoice.id)}`);
        const d = (await r.json()) as { status?: string; paidSoFarKes?: number };
        if (d.status === "paid") { setStep("paid"); clearInterval(t); router.refresh(); return; }
        if ((d.paidSoFarKes ?? 0) > 0) { setPaidSoFar(d.paidSoFarKes ?? 0); setStep("paybill_partial"); }
      } catch { /* keep polling */ }
      if (Date.now() - started > 120_000) { clearInterval(t); setStep((s) => (s === "paid" ? s : "paybill_pending")); }
    }, 4000);
  };

  const payWithCard = async () => {
    if (!invoice) return;
    setErrorMsg(null);
    setStep("card_redirecting");
    const result = await initiateInvoiceCardPaymentAction(invoice.id);
    if ("error" in result) {
      setStep("breakdown");
      setErrorMsg(result.error);
      return;
    }
    // Full page navigation to Stripe's real hosted Checkout — no card form
    // of any kind lives in this app, so there's nothing here to poll; the
    // redirect back to success_url/cancel_url IS the "waiting" step.
    window.location.href = result.url;
  };

  const copyInvoiceNumber = () => {
    if (!invoice) return;
    navigator.clipboard.writeText(invoice.invoiceNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <>
      {!hideTrigger && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-2.5">
          <div>
            <div className="text-sm font-medium">{planName}</div>
            <div className="text-xs text-muted">{priceMonthly > 0 ? `${kes(priceMonthly)}/mo + usage` : "Contact us for pricing"}</div>
          </div>
          <button
            type="button"
            onClick={() => start()}
            className="shrink-0 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5"
          >
            Upgrade
          </button>
        </div>
      )}

      <Modal open={open} onClose={close} title={exhausted ? "Keep the replies going" : `Upgrade to ${planName}`} closeOnBackdrop={step !== "waiting"}>
        {exhausted && step !== "paid" && (
          <div className="animate-in mb-5 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-4 text-white shadow-[var(--shadow-accent-glow)]">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-white/80">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-white/20 text-[13px]">⚡</span> {exhausted.title}
            </div>
            <p className="mt-2 text-[15px] font-medium leading-snug">{exhausted.detail}</p>
            <p className="mt-2 text-sm text-white/85">Would you like to top up now? It takes less than a minute, and replies resume the moment payment confirms.</p>
          </div>
        )}
        {step === "choose_plan" && exhausted && (
          <div className="space-y-2">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Choose a plan to continue</p>
            {exhausted.planOptions.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => { setActivePlan(p); setStep("extra_messages"); }}
                className="flex w-full items-center justify-between rounded-xl border border-line-soft px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent-soft"
              >
                <span>
                  <span className="block text-sm font-semibold">{p.name}</span>
                  <span className="block text-xs text-muted">{kes(p.priceMonthly)}/mo + usage</span>
                </span>
                <span className="text-xs font-medium text-accent">Select →</span>
              </button>
            ))}
          </div>
        )}

        {step === "extra_messages" && exhausted && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">{activePlan.name} — {kes(activePlan.priceMonthly)}/mo</p>
            <p className="mb-4 text-sm text-muted">A plan alone doesn&apos;t guarantee enough balance to reply right away — top up your message balance now so replies can resume the moment you pay. You can also skip this and top up later.</p>

            <div className="rounded-2xl border border-line-soft bg-surface-2 p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium">Extra messages</span>
                <span className="font-display text-2xl font-bold text-accent-ink">{extraMessages.toLocaleString("en-US")}</span>
              </div>
              <input
                type="range"
                min={0}
                max={TOPUP_MAX_MESSAGES}
                step={TOPUP_STEP_MESSAGES}
                value={extraMessages}
                onChange={(e) => setExtraMessages(Number(e.target.value))}
                className="mt-3 w-full accent-[var(--color-accent)]"
              />
              <div className="mt-1 flex justify-between text-[11px] text-faint">
                <span>0</span>
                <span>{TOPUP_MAX_MESSAGES.toLocaleString("en-US")}</span>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3 text-sm">
                <span className="text-muted">{extraMessages.toLocaleString("en-US")} messages × {kes(exhausted.pricePerMessageKes)}</span>
                <span className="font-semibold">{kes(extraMessages * exhausted.pricePerMessageKes)}</span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl bg-accent-soft px-4 py-3">
              <span className="text-sm font-medium text-accent-ink">Plan + top-up, due now</span>
              <span className="font-display text-lg font-bold text-accent-ink">{kes(activePlan.priceMonthly + extraMessages * exhausted.pricePerMessageKes)}</span>
            </div>
            <p className="mt-1.5 text-[11px] text-faint">Your exact amount due (after any remaining credit from your current plan) is confirmed on the next step, before you pay.</p>

            <button
              type="button"
              onClick={() => void start(activePlan, extraMessages)}
              className="mt-4 w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-3 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5"
            >
              Continue to payment
            </button>
          </div>
        )}

        {step === "loading" && <p className="text-sm text-muted">Calculating your upgrade…</p>}

        {step === "error" && (
          <div>
            <p className="text-sm text-rose">{errorMsg}</p>
            <button type="button" onClick={close} className="mt-4 rounded-xl border border-line-soft px-4 py-2 text-sm font-medium hover:bg-surface-2">Close</button>
          </div>
        )}

        {invoice && step !== "loading" && step !== "error" && step !== "paid" && (
          <div>
            <table className="w-full text-sm">
              <tbody>
                <Row label="Invoice" value={invoice.invoiceNumber} />
                <Row label="Current plan" value={invoice.fromPlan?.name ?? "Trial"} />
                <Row label="Current plan value" value={kes(invoice.fromPlanValueKes)} />
                <Row label={`Remaining (${invoice.remainingDays} of ${invoice.daysInCycle} days)`} value={`− ${kes(invoice.remainingValueKes)}`} />
                <Row label={`${invoice.toPlan.name} plan price`} value={kes(invoice.toPlanPriceKes)} />
                {invoice.messageTopupMessages > 0 && (
                  <Row label={`Message top-up (${invoice.messageTopupMessages.toLocaleString("en-US")} messages)`} value={kes(invoice.messageTopupKes)} />
                )}
                <tr className="border-t border-line">
                  <td className="py-2.5 font-semibold">Amount payable</td>
                  <td className="py-2.5 text-right font-semibold">{kes(invoice.payableKes)}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-xs text-faint">Your remaining subscription value is applied automatically — you're only charged the difference shown above.</p>

            {step === "breakdown" && (
              <div className="mt-5 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-faint">Choose a payment method</p>
                <button
                  type="button"
                  onClick={() => setStep("phone")}
                  className="flex w-full items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <span>M-Pesa STK Push</span>
                  <span className="text-xs text-green">Available</span>
                </button>
                {paybill.available ? (
                  <button
                    type="button"
                    onClick={startPaybill}
                    className="flex w-full items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft"
                  >
                    <span>M-Pesa Paybill</span>
                    <span className="text-xs text-green">Available</span>
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm font-medium opacity-50">
                    <span>M-Pesa Paybill</span>
                    <span className="text-xs text-faint">Coming soon</span>
                  </div>
                )}
                {cardAvailable ? (
                  <button
                    type="button"
                    onClick={payWithCard}
                    className="flex w-full items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm font-medium transition-colors hover:border-accent hover:bg-accent-soft"
                  >
                    <span>Visa / Card</span>
                    <span className="text-xs text-green">Available</span>
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-between rounded-xl border border-line-soft px-3.5 py-2.5 text-sm font-medium opacity-50">
                    <span>Visa / Card</span>
                    <span className="text-xs text-faint">Coming soon</span>
                  </div>
                )}
              </div>
            )}

            {step === "card_redirecting" && (
              <p className="mt-5 text-sm text-amber">Redirecting to a secure Stripe checkout page…</p>
            )}

            {step === "phone" && (
              <div className="mt-5">
                <label className="mb-1 block text-xs font-medium text-muted">M-Pesa phone number</label>
                <div className="flex gap-2">
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. 0712345678"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={payWithStk}
                    className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)]"
                  >
                    Pay {kes(invoice.payableKes)}
                  </button>
                </div>
                {errorMsg && <p className="mt-2 text-sm text-rose">{errorMsg}</p>}
              </div>
            )}

            {step === "waiting" && (
              <p className="mt-5 text-sm text-amber">📲 STK push sent{ref ? ` (ref ${ref})` : ""} — enter your M-Pesa PIN on your phone to approve.</p>
            )}

            {(step === "paybill" || step === "paybill_partial" || step === "paybill_pending") && (
              <div className="mt-5 rounded-xl border border-line-soft p-4">
                <p className="mb-3 text-sm font-semibold">Pay with M-Pesa Paybill</p>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Paybill Number</span>
                    <span className="font-mono font-semibold">{paybill.shortcode}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Account Number</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-base font-bold text-accent-ink">{invoice.invoiceNumber}</span>
                      <button type="button" onClick={copyInvoiceNumber} className="rounded-md border border-line-soft px-2 py-0.5 text-xs hover:bg-surface-2">
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Amount</span>
                    <span className="font-semibold">{kes(invoice.payableKes)}</span>
                  </div>
                </div>
                <ol className="mt-4 list-decimal space-y-1 pl-5 text-xs text-muted">
                  <li>Open M-Pesa</li>
                  <li>Select Lipa na M-Pesa</li>
                  <li>Select Pay Bill</li>
                  <li>Enter the Paybill number above</li>
                  <li>Enter the invoice number above as the Account Number</li>
                  <li>Enter {kes(invoice.payableKes)}</li>
                  <li>Confirm payment</li>
                </ol>
                <p className="mt-3 text-xs font-medium text-rose">Important: enter the invoice number exactly as shown above as the Account Number.</p>

                {step === "paybill" && <p className="mt-4 text-sm text-amber">Waiting for payment…</p>}
                {step === "paybill_partial" && (
                  <p className="mt-4 text-sm text-amber">We received {kes(paidSoFar)} toward this invoice — {kes(invoice.payableKes - paidSoFar)} still due.</p>
                )}
                {step === "paybill_pending" && (
                  <p className="mt-4 text-sm text-muted">Still waiting — you can close this safely, we&apos;ll apply it automatically the moment it arrives, and you&apos;ll see it on your dashboard.</p>
                )}
              </div>
            )}

            {step === "failed" && (
              <div className="mt-5">
                <p className="text-sm text-rose">Payment was cancelled or failed. Your plan has not changed.</p>
                <button type="button" onClick={() => setStep("phone")} className="mt-3 rounded-xl border border-line-soft px-4 py-2 text-sm font-medium hover:bg-surface-2">Try again</button>
              </div>
            )}
          </div>
        )}

        {step === "paid" && invoice && (
          <div>
            <p className="text-sm text-green">✓ Payment confirmed — invoice {invoice.invoiceNumber}, {kes(invoice.payableKes)} paid.</p>
            <p className="mt-2 text-sm">
              Your plan is now <strong>{invoice.toPlan.name}</strong>.{invoice.remainingValueKes > 0 ? ` Your remaining ${kes(invoice.remainingValueKes)} credit from your previous plan was applied.` : ""}
              {invoice.messageTopupMessages > 0 ? ` ${kes(invoice.messageTopupKes)} was added to your message balance (${invoice.messageTopupMessages.toLocaleString("en-US")} messages) — replies resume right away.` : ""}
            </p>
            <button type="button" onClick={close} className="mt-4 rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2 text-sm font-semibold text-white">Done</button>
          </div>
        )}
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-t border-line-soft">
      <td className="py-2 text-muted">{label}</td>
      <td className="py-2 text-right">{value}</td>
    </tr>
  );
}
