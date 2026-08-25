"use client";

import { useState } from "react";
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
  usedDays: number; remainingDays: number; daysInCycle: number;
  fromPlan: { name: string } | null; toPlan: { name: string; limits: unknown };
};

type Step = "loading" | "breakdown" | "phone" | "waiting" | "paybill" | "paybill_partial" | "paybill_pending" | "card_redirecting" | "paid" | "failed" | "error";

export function UpgradeModal({ planId, planName, priceMonthly }: { planId: string; planName: string; priceMonthly: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("loading");
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  const [paybill, setPaybill] = useState<{ available: boolean; shortcode?: string }>({ available: false });
  const [cardAvailable, setCardAvailable] = useState(false);
  const [copied, setCopied] = useState(false);
  const [paidSoFar, setPaidSoFar] = useState(0);

  const start = async () => {
    setOpen(true);
    setStep("loading");
    setErrorMsg(null);
    const [result, pb, card] = await Promise.all([createUpgradeInvoiceAction(planId), getPaybillInfo(), getCardInfo()]);
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
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line-soft px-3.5 py-2.5">
        <div>
          <div className="text-sm font-medium">{planName}</div>
          <div className="text-xs text-muted">{priceMonthly > 0 ? `${kes(priceMonthly)}/mo + usage` : "Contact us for pricing"}</div>
        </div>
        <button
          type="button"
          onClick={start}
          className="shrink-0 rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 text-xs font-semibold text-white transition-transform hover:-translate-y-0.5"
        >
          Upgrade
        </button>
      </div>

      <Modal open={open} onClose={close} title={`Upgrade to ${planName}`} closeOnBackdrop={step !== "waiting"}>
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
            <p className="mt-2 text-sm">Your plan is now <strong>{invoice.toPlan.name}</strong>.{invoice.remainingValueKes > 0 ? ` Your remaining ${kes(invoice.remainingValueKes)} credit from your previous plan was applied.` : ""}</p>
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
