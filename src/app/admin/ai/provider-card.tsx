"use client";

import { useState, useTransition, useActionState, useEffect } from "react";
import { toast } from "sonner";
import {
  ExternalLink, Star, Sparkles, Zap, Cpu, Waypoints, Bot, CircleDot, Rocket, Plus,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui";
import { updateAiProviderCostAction, setPrimaryProviderAction, addAiProviderKeyAction, revokeAiProviderKeyAction } from "@/lib/admin-actions";
import { ReasonAction } from "@/components/admin/reason-action";

// Icon lookup lives here (client-only) — passing a Lucide component
// reference itself as a prop from the server page into this client
// component isn't safe RSC serialization, so the page passes a plain
// provider id string and this file owns the id → icon mapping.
const PROVIDER_ICONS: Record<string, LucideIcon> = {
  google: Sparkles, groq: Zap, cerebras: Cpu, openrouter: Waypoints, anthropic: Bot, openai: CircleDot, xai: Rocket,
};

export type ProviderCardData = {
  id: string; label: string; configured: boolean; isPrimary: boolean;
  tone: "green" | "amber" | "rose" | "neutral"; statusLabel: string;
  calls: number; successes: number; failures: number; lastError: string | null;
  quotaRemaining: number | null; quotaLimit: number | null;
  costPerCallKes: number; estimatedSpendMonthKes: number;
  // true once this provider has real per-token AiRequestLog cost data for the
  // month (see /admin/models) — the figure shown is then the REAL cost, not
  // the calls×cost-per-call estimate, closing the gap where this page and
  // /admin/models could show two different numbers for the same provider.
  spendIsReal: boolean;
  topUpUrl: string;
  // One entry per configured key (singular env var, or every key in the
  // _API_KEYS pool) — coolingDown reflects the SAME in-memory state
  // callLLM()'s rotation actually uses, not a separate guess. A key never
  // yet attempted since the last deploy shows as live by default.
  keys: { label: string; coolingDown: boolean; cooldownUntil: number | null }[];
  // Real, admin-added keys, 2026-08-26 — numbered by creation order, each
  // with real tracked token usage and an admin-entered starting-balance
  // estimate (no provider here exposes a live balance API). Empty until an
  // admin adds the provider's first real key — that provider keeps running
  // on its env-var key(s) exactly as before until then.
  dbKeys: { id: string; number: number; maskedPreview: string; tokensUsed: number; startingBalanceUsd: number | null; remainingUsd: number | null }[];
};

export function ProviderCard({ data }: { data: ProviderCardData }) {
  const Icon = PROVIDER_ICONS[data.id] ?? CircleDot;
  const [cost, setCost] = useState(String(data.costPerCallKes));
  const [pending, startTransition] = useTransition();

  const quotaPct = data.quotaRemaining != null && data.quotaLimit ? Math.max(0, Math.min(100, (data.quotaRemaining / data.quotaLimit) * 100)) : null;

  return (
    <div className={`rounded-2xl border p-4 transition-all hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] ${data.isPrimary ? "border-accent/40 bg-accent-soft/40" : "border-line"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`grid h-8 w-8 place-items-center rounded-lg ${data.configured ? "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] text-white" : "bg-surface-2 text-faint"}`}>
            <Icon size={15} />
          </span>
          <span className="font-medium">{data.label}</span>
        </div>
        {data.isPrimary && <Badge tone="accent">primary</Badge>}
      </div>

      <div className="mt-2.5"><Badge tone={data.tone} dot>{data.statusLabel}</Badge></div>
      <div className="mt-2 text-xs text-muted">{data.configured ? `${data.calls} call${data.calls === 1 ? "" : "s"} today · ${data.successes} ok · ${data.failures} failed` : "No API key set in environment"}</div>

      {data.keys.length > 1 && (
        <div className="mt-2">
          <div className="flex items-center gap-1">
            {data.keys.map((k) => (
              <span
                key={k.label}
                title={k.coolingDown ? `Key ${k.label} — resting off a recent failure${k.cooldownUntil ? `, resumes ~${Math.max(1, Math.round((k.cooldownUntil - Date.now()) / 60000))}m` : ""}` : `Key ${k.label} — live`}
                className={`h-2 w-2 rounded-full ${k.coolingDown ? "bg-rose" : "bg-green"}`}
              />
            ))}
          </div>
          <div className="mt-1 text-[11px] text-faint">
            {data.keys.filter((k) => !k.coolingDown).length}/{data.keys.length} keys live
          </div>
        </div>
      )}

      {quotaPct != null && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${quotaPct < 15 ? "bg-rose" : quotaPct < 40 ? "bg-amber" : "bg-green"}`} style={{ width: `${quotaPct}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-faint">{data.quotaRemaining}/{data.quotaLimit} quota left today</div>
        </div>
      )}
      {data.lastError && data.tone !== "green" && <div className="mt-1.5 truncate text-[11px] text-faint" title={data.lastError}>Last error: {data.lastError}</div>}

      {data.configured && (
        <>
          <div className="mt-3 border-t border-line-soft pt-3">
            <label className="flex items-center gap-2 text-xs">
              <span className="text-muted">Cost / call (KES)</span>
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                onBlur={() => {
                  const n = Number(cost);
                  if (!Number.isFinite(n) || n < 0) { toast.error("Enter a valid cost"); return; }
                  startTransition(async () => {
                    const fd = new FormData();
                    fd.set("provider", data.id);
                    fd.set("costPerCallKes", String(n));
                    const res = await updateAiProviderCostAction(null, fd);
                    if (res && "error" in res) toast.error(res.error);
                    else toast.success(`${data.label} cost updated`);
                  });
                }}
                type="number" step="0.01" min="0"
                className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-accent"
              />
            </label>
            <div className="mt-1 text-[11px] text-faint">
              {data.spendIsReal ? "" : "≈ "}KES {data.estimatedSpendMonthKes.toLocaleString("en-US")} spent this month
              {data.spendIsReal ? " (real per-token cost, see Models)" : ` (${data.successes > 0 || data.calls > 0 ? "real usage" : "no calls yet"} × cost above)`}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            {!data.isPrimary && (
              <ReasonAction
                label={<span className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-muted hover:bg-surface-2"><Star size={12} /> Set primary</span>}
                confirmLabel="Set primary"
                onConfirm={(reason) => setPrimaryProviderAction(data.id, reason)}
                successMessage={`${data.label} is now primary`}
              />
            )}
            <a href={data.topUpUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-accent-ink hover:bg-accent-soft">
              <ExternalLink size={12} /> Top up credits
            </a>
          </div>
        </>
      )}
      {pending && <div className="mt-1 text-[10px] text-faint">Saving…</div>}

      <AiKeyManager providerId={data.id} providerLabel={data.label} dbKeys={data.dbKeys} />
    </div>
  );
}

/** Real, admin-editable key list — click "Add key," paste it, it becomes
 *  "Key 1"/"Key 2"/... with its own tracked token usage and an admin-entered
 *  starting-balance estimate (no provider here exposes a live balance API).
 *  Separate from the cooldown dot-row above, which reflects live/resting
 *  health of WHICHEVER keys are actually in use (DB or env) — this section
 *  is specifically about managing the real, persisted key pool. */
function AiKeyManager({ providerId, providerLabel, dbKeys }: { providerId: string; providerLabel: string; dbKeys: ProviderCardData["dbKeys"] }) {
  const [showAdd, setShowAdd] = useState(false);
  const [addState, addAction, addPending] = useActionState(addAiProviderKeyAction, null as Awaited<ReturnType<typeof addAiProviderKeyAction>> | null);

  useEffect(() => {
    if (!addState) return;
    if ("ok" in addState) { toast.success(`Key added to ${providerLabel}`); setShowAdd(false); }
    else toast.error(addState.error);
  }, [addState, providerLabel]);

  return (
    <div className="mt-3 border-t border-line-soft pt-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">API keys ({dbKeys.length})</div>
      {dbKeys.length > 0 && (
        <ul className="mt-1.5 space-y-1.5">
          {dbKeys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="font-mono text-muted">
                Key {k.number} — {k.maskedPreview} — {k.tokensUsed.toLocaleString("en-US")} tokens used
                {k.startingBalanceUsd != null && <> — ${k.remainingUsd?.toFixed(2)} of ${k.startingBalanceUsd.toFixed(2)} remaining</>}
              </span>
              <ReasonAction
                label={<span className="text-rose hover:underline">Revoke</span>}
                confirmLabel="Revoke key"
                onConfirm={(reason) => revokeAiProviderKeyAction(k.id, reason)}
                successMessage={`Key ${k.number} revoked`}
              />
            </li>
          ))}
        </ul>
      )}

      {showAdd ? (
        <form action={addAction} className="mt-2 space-y-1.5">
          <input type="hidden" name="provider" value={providerId} />
          <input name="key" type="password" placeholder="Paste API key" required className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent" />
          <input name="startingBalanceUsd" type="number" step="0.01" min="0" placeholder="Starting balance, $ (optional)" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent" />
          <div className="flex gap-1.5">
            <button type="submit" disabled={addPending} className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
              {addPending ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:bg-surface-2">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setShowAdd(true)} className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-ink">
          <Plus size={11} /> Add key
        </button>
      )}
    </div>
  );
}
