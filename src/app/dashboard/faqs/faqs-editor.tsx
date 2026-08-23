"use client";

import { useActionState, useState, useEffect } from "react";
import { toast } from "sonner";
import { saveFaqsAction, crawlWebsiteAction } from "@/lib/actions";
import { Card } from "@/components/ui";

type Faq = { q: string; a: string };
type State = { ok?: boolean; count?: number; error?: string; unchanged?: boolean } | null;
type CrawlState = { ok?: boolean; draft?: Faq[]; pagesScanned?: number; error?: string } | null;

export function FaqsEditor({ initial, canManage }: { initial: Faq[]; canManage: boolean }) {
  const [rows, setRows] = useState<Faq[]>(initial.length ? initial : [{ q: "", a: "" }]);
  const [state, action, pending] = useActionState(saveFaqsAction, null as State);
  const [crawlState, crawlAction, crawling] = useActionState(crawlWebsiteAction, null as CrawlState);

  // Merge a fresh crawl draft into the editable list — never auto-saved,
  // the admin still reviews/edits/removes rows here before hitting the
  // existing Save button below, same reviewable-draft rule as everywhere
  // else new content gets pulled in (OpenAPI import, the marketplace).
  useEffect(() => {
    if (crawlState?.ok && crawlState.draft?.length) {
      setRows((r) => {
        const withoutBlank = r.filter((row) => row.q || row.a);
        return [...withoutBlank, ...crawlState.draft!];
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawlState]);

  // Real bug fixed in a UX audit, 2026-08-23 (Phase 3): success previously
  // only showed as an inline banner, easy to miss if the page had scrolled.
  // Moved to a toast (matching the pattern used everywhere else in the
  // dashboard/admin apps) while keeping the error banner inline, right next
  // to the form — errors benefit from staying anchored and visible longer
  // than a toast's auto-dismiss window. The crawl action's own inline
  // banner (below) is deliberately left as-is, not converted: it needs to
  // stay visible while the admin reviews the draft rows it adds, which a
  // transient toast wouldn't serve as well.
  useEffect(() => {
    if (!state?.ok) return;
    if (state.unchanged) toast("No changes were made");
    else toast.success(`Saved — your assistant now uses ${state.count} approved answer${state.count === 1 ? "" : "s"}.`);
  }, [state]);

  const update = (i: number, key: keyof Faq, value: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const remove = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const add = () => setRows((r) => [...r, { q: "", a: "" }]);

  const payload = JSON.stringify(rows.map((r) => ({ q: r.q.trim(), a: r.a.trim() })).filter((r) => r.q && r.a));

  return (
    <>
      {/* A genuinely separate <form>, not nested inside the Save FAQs form
          below (HTML doesn't allow forms to nest) — its own input/button are
          literal children of THIS form, the standard, reliably-supported
          pattern for a distinct server action. */}
      {canManage && (
        <form action={crawlAction}>
          <Card className="mb-4 p-4">
            <h3 className="mb-1 text-sm font-semibold">Import from your website</h3>
            <p className="mb-3 text-xs text-muted">Scans your site&apos;s own public pages and drafts candidate FAQ entries below for you to review — nothing is saved until you edit/approve and hit Save FAQs.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                name="url"
                placeholder="https://your-school.example.com"
                className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <button type="submit" disabled={crawling} className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2 disabled:opacity-60">
                {crawling ? "Scanning…" : "Scan this site"}
              </button>
            </div>
            {crawlState?.ok && <p className="mt-2 text-xs text-green">Scanned {crawlState.pagesScanned} page{crawlState.pagesScanned === 1 ? "" : "s"} — {crawlState.draft?.length} draft answer{crawlState.draft?.length === 1 ? "" : "s"} added below. Review before saving.</p>}
            {crawlState?.error && <p className="mt-2 text-xs text-rose">{crawlState.error}</p>}
          </Card>
        </form>
      )}
      <form action={action}>
        <input type="hidden" name="faqs" value={payload} />

        {state?.error && <div className="mb-3 rounded-xl border border-rose/30 bg-rose-soft p-3 text-sm text-rose">{state.error}</div>}

      <div className="space-y-3">
        {rows.map((row, i) => (
          <Card key={i} className="p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-faint">FAQ {i + 1}</span>
              {canManage && rows.length > 1 && (
                <button type="button" onClick={() => remove(i)} className="text-xs text-rose hover:underline">Remove</button>
              )}
            </div>
            <label className="mb-1 block text-xs text-muted">Question people might ask</label>
            <input
              value={row.q}
              onChange={(e) => update(i, "q", e.target.value)}
              disabled={!canManage}
              placeholder="e.g. What are the school hours?"
              className="mb-3 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
            <label className="mb-1 block text-xs text-muted">Approved answer (used word-for-word)</label>
            <textarea
              value={row.a}
              onChange={(e) => update(i, "a", e.target.value)}
              disabled={!canManage}
              rows={2}
              placeholder="e.g. School runs Monday to Friday, 7:30am to 4:30pm."
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-60"
            />
          </Card>
        ))}
      </div>

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={add} className="rounded-xl border border-line px-4 py-2 text-sm font-medium hover:bg-surface-2">
            + Add FAQ
          </button>
          <button type="submit" disabled={pending} className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0">
            {pending ? "Saving…" : "Save FAQs"}
          </button>
        </div>
      )}
      </form>
    </>
  );
}
