"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSearch } from "lucide-react";
import { Modal } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { searchInvoicesForReconciliationAction, previewInvoiceMatchAction, matchUnmatchedTransactionToInvoiceAction } from "@/lib/reconciliation-actions";

type SearchResult = { id: string; invoiceNumber: string; tenantName: string; status: string; payableKes: number };
type Preview = { invoiceNumber: string; tenantName: string; status: string; payableKes: number; paidSoFarKes: number; incomingKes: number; resultingKes: number; isTerminal: boolean; wouldSettle: boolean };

const kes = (n: number) => `KES ${n.toLocaleString("en-US")}`;
const STATUS_TONE: Record<string, "green" | "amber" | "rose" | "neutral"> = { awaiting_payment: "amber", paid: "green", cancelled: "neutral", expired: "rose" };

type State = { error?: string; ok?: boolean } | null;

function InvoiceMatchForm({ txId, defaultQuery, incomingKes, onDone }: { txId: string; defaultQuery: string; incomingKes: number; onDone: () => void }) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const res = await searchInvoicesForReconciliationAction(query);
      if ("results" in res) setResults(res.results);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const selectInvoice = async (r: SearchResult) => {
    setSelected(r);
    setPreview(null);
    setPreviewError(null);
    const res = await previewInvoiceMatchAction(r.id, incomingKes);
    if (!("ok" in res) || !res.ok) { setPreviewError(("error" in res && res.error) || "Could not load preview."); return; }
    setPreview(res);
  };

  const bound = async (_prev: State, formData: FormData) => {
    const reason = String(formData.get("reason") ?? "");
    if (!selected) return { error: "Select an invoice first." };
    return matchUnmatchedTransactionToInvoiceAction(txId, selected.id, reason);
  };
  const [state, action, pending] = useActionState<State, FormData>(bound, null);

  useEffect(() => {
    if (state?.ok) { toast.success("Matched — payment attached to invoice"); onDone(); }
    if (state?.error) toast.error(state.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-xs font-medium text-muted">Search invoice number</span>
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelected(null); setPreview(null); }}
          placeholder="e.g. INV-2026-000123"
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </label>

      {query.trim() && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-line-soft p-1.5">
          {searching && <div className="px-2 py-1.5 text-xs text-muted">Searching…</div>}
          {!searching && results.length === 0 && <div className="px-2 py-1.5 text-xs text-muted">No matching invoices.</div>}
          {results.map((r) => (
            <button
              type="button"
              key={r.id}
              onClick={() => selectInvoice(r)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-surface-2 ${selected?.id === r.id ? "bg-accent-soft" : ""}`}
            >
              <span className="min-w-0 truncate">
                <span className="font-mono">{r.invoiceNumber}</span> <span className="text-muted">· {r.tenantName}</span>
              </span>
              <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status.replace(/_/g, " ")}</Badge>
            </button>
          ))}
        </div>
      )}

      {previewError && <p className="text-xs text-rose">{previewError}</p>}

      {preview && (
        <div className="space-y-1.5 rounded-xl border border-line-soft bg-surface-2 p-3 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-faint">Expected result (advisory — recalculated when you confirm)</div>
          <div className="flex justify-between"><span className="text-muted">Invoice</span><span className="font-mono">{preview.invoiceNumber}</span></div>
          <div className="flex justify-between"><span className="text-muted">Tenant</span><span>{preview.tenantName}</span></div>
          <div className="flex justify-between"><span className="text-muted">Invoice status</span><Badge tone={STATUS_TONE[preview.status] ?? "neutral"}>{preview.status.replace(/_/g, " ")}</Badge></div>
          <div className="flex justify-between"><span className="text-muted">Payable</span><span>{kes(preview.payableKes)}</span></div>
          <div className="flex justify-between"><span className="text-muted">Already paid</span><span>{kes(preview.paidSoFarKes)}</span></div>
          <div className="flex justify-between"><span className="text-muted">This payment</span><span>{kes(preview.incomingKes)}</span></div>
          <div className="flex justify-between border-t border-line-soft pt-1.5 font-medium"><span>Resulting total</span><span>{kes(preview.resultingKes)}</span></div>
          {preview.isTerminal ? (
            <p className="mt-1 rounded-lg bg-amber-soft px-2.5 py-2 text-xs text-amber">
              ⚠ This invoice is already {preview.status.replace(/_/g, " ")} — this payment will be recorded as evidence only. No plan change will occur.
            </p>
          ) : (
            <p className={`mt-1 rounded-lg px-2.5 py-2 text-xs ${preview.wouldSettle ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>
              {preview.wouldSettle ? "✓ Would settle — plan change would apply." : "Would NOT settle yet — partial payment, invoice stays awaiting payment."}
            </p>
          )}
        </div>
      )}

      <label className="block">
        <span className="text-xs font-medium text-muted">Reason (required, audit trail)</span>
        <input name="reason" required placeholder="e.g. Customer confirmed this was for invoice INV-2026-000123, typo'd the reference" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent" />
      </label>

      <button type="submit" disabled={pending || !selected} className="w-full rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] disabled:opacity-60">
        {pending ? "Matching…" : "Match to invoice"}
      </button>
    </form>
  );
}

export function InvoiceMatchModal({ txId, providerRef, defaultQuery, amountKes }: { txId: string; providerRef: string; defaultQuery: string; amountKes: number }) {
  return (
    <Modal
      title={`Match transaction ${providerRef} to an invoice`}
      description="Attaches this payment as evidence to a specific invoice and re-runs settlement — a distinct financial action from matching to a tenant's recurring bill."
      contentClassName="max-w-lg"
      trigger={
        <button className="flex items-center gap-1 rounded-lg border border-accent/30 px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-soft">
          <FileSearch size={12} /> Match to invoice
        </button>
      }
    >
      <InvoiceMatchForm txId={txId} defaultQuery={defaultQuery} incomingKes={amountKes} onDone={() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))} />
    </Modal>
  );
}
