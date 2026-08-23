"use client";

import { useActionState, useEffect, useState } from "react";
import { createConnectorFromDraftAction } from "@/lib/actions";
import type { DraftAction } from "@/lib/openapi-import";
import { Card, Badge } from "@/components/ui";
import { PasswordInput } from "@/components/password-input";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

type EditableAction = DraftAction & { included: boolean; requiredPermission: string };

// Resume-on-refresh: see the "UX pattern — resuming an interrupted multi-step
// flow" note in docs/ROADMAP-UNIVERSAL-PLATFORM-2026-08-19.md, flagged there
// as the same gap /onboard had before that fix. Deliberately does NOT persist
// credential fields (apiKeyValue/bearerToken/basicPass) — those stay plain
// uncontrolled inputs, never touch React state, and are never written to
// sessionStorage even indirectly. A refresh loses a not-yet-submitted
// credential the same way any browser form would; it does NOT lose the
// (much more tedious to redo) per-capability review edits.
const REVIEW_STORAGE_KEY = "p2less_connector_review_progress";
type SavedReview = {
  draftHash: string;
  connectorName: string;
  connectorDescription: string;
  baseUrl: string;
  authType: string;
  actions: EditableAction[];
};

function hashDraft(name: string, baseUrl: string, actions: DraftAction[]): string {
  const s = name + "|" + baseUrl + "|" + JSON.stringify(actions);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function saveReview(r: SavedReview | null) {
  try {
    if (r) sessionStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(REVIEW_STORAGE_KEY);
  } catch {
    // Storage disabled/unavailable — resuming just won't work this time.
  }
}

function loadReview(): SavedReview | null {
  try {
    const raw = sessionStorage.getItem(REVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.draftHash ? (parsed as SavedReview) : null;
  } catch {
    return null;
  }
}

/** The reviewed-draft-then-create step, shared by BOTH ways of getting a
 *  draft capability set in front of an admin: pasting an OpenAPI spec
 *  (Phase 6, openapi-import-form.tsx) and installing a marketplace template
 *  (Phase 7, marketplace-install-form.tsx). Same review UI, same submit
 *  action (createConnectorFromDraftAction) — only where the initial draft
 *  came from differs. */
export function ConnectorDraftReviewForm({
  initialName,
  initialDescription,
  initialBaseUrl,
  initialActions,
  onBack,
  backLabel,
}: {
  initialName: string;
  initialDescription: string;
  initialBaseUrl: string;
  initialActions: DraftAction[];
  onBack: () => void;
  backLabel: string;
}) {
  const draftHash = hashDraft(initialName, initialBaseUrl, initialActions);

  const [connectorName, setConnectorName] = useState(initialName);
  const [connectorDescription, setConnectorDescription] = useState(initialDescription);
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [authType, setAuthType] = useState("api_key");
  const [actions, setActions] = useState<EditableAction[]>(() => initialActions.map((a) => ({ ...a, included: true, requiredPermission: "" })));

  const [createState, createAction, creating] = useActionState(createConnectorFromDraftAction, null as { error?: string } | null);

  // Guards against a real timing bug: a plain boolean ref flipped in the
  // restore effect is NOT enough here — both effects fire in the same
  // commit on mount (declared-order, one after the other), so a ref flip in
  // the first is already visible to the second in that SAME pass, before
  // the restore effect's setState calls have actually taken effect (those
  // land on the NEXT render). The save effect would still fire once with
  // the stale pre-restore values and wipe the snapshot it was meant to
  // preserve. Using STATE (not a ref) for the gate fixes it: setHydrated
  // batches with the other restore setState calls, so "hydrated" and the
  // restored values become true/current together, on the same next render —
  // the save effect only ever sees the fully-restored state, never the
  // stale mid-restore snapshot.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadReview();
    if (saved && saved.draftHash === draftHash) {
      setConnectorName(saved.connectorName);
      setConnectorDescription(saved.connectorDescription);
      setBaseUrl(saved.baseUrl);
      setAuthType(saved.authType);
      setActions(saved.actions);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveReview({ draftHash, connectorName, connectorDescription, baseUrl, authType, actions });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, draftHash, connectorName, connectorDescription, baseUrl, authType, actions]);

  function handleBack() {
    saveReview(null);
    onBack();
  }

  function updateAction(i: number, patch: Partial<EditableAction>) {
    setActions((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }

  const includedCount = actions.filter((a) => a.included).length;
  const actionsJson = JSON.stringify(
    actions.filter((a) => a.included).map(({ included: _included, ...rest }) => rest)
  );

  return (
    <form action={createAction} className="space-y-4">
      <input type="hidden" name="actionsJson" value={actionsJson} />

      <Card className="space-y-4 p-5">
        <h2 className="font-display font-semibold">System</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className={label}>Name</label><input name="name" required value={connectorName} onChange={(e) => setConnectorName(e.target.value)} className={field} /></div>
          <div><label className={label}>Base URL</label><input name="baseUrl" required value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={field} /></div>
        </div>
        <div><label className={label}>Description</label><input name="description" value={connectorDescription} onChange={(e) => setConnectorDescription(e.target.value)} className={field} /></div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="font-display font-semibold">Authentication</h2>
        <div>
          <label className={label}>Method</label>
          <select name="authType" value={authType} onChange={(e) => setAuthType(e.target.value)} className={field}>
            <option value="none">None</option>
            <option value="api_key">API key (header)</option>
            <option value="bearer">Bearer token</option>
            <option value="basic">Basic auth</option>
          </select>
          <p className="mt-1 text-[11px] text-faint">Credentials are encrypted at rest and never shown again or logged. Fill in the real credentials for YOUR system — none are provided here.</p>
        </div>
        {authType === "api_key" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={label}>Header name</label><input name="apiKeyHeader" defaultValue="x-api-key" className={field} /></div>
            <div><label className={label}>Key value</label><PasswordInput name="apiKeyValue" className={field} /></div>
          </div>
        )}
        {authType === "bearer" && <div><label className={label}>Token</label><PasswordInput name="bearerToken" className={field} /></div>}
        {authType === "basic" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className={label}>Username</label><input name="basicUser" className={field} /></div>
            <div><label className={label}>Password</label><PasswordInput name="basicPass" className={field} /></div>
          </div>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-semibold">Draft capabilities</h2>
          <span className="text-xs text-muted">{includedCount} of {actions.length} selected</span>
        </div>
        <p className="text-[11px] text-faint">Review every row before creating anything — nothing here is live yet. Uncheck anything you don't want as a conversational capability.</p>
        <div className="space-y-3">
          {actions.map((a, i) => (
            <div key={i} className={`rounded-lg border p-3 ${a.included ? "border-line" : "border-line-soft opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <input type="checkbox" checked={a.included} onChange={(e) => updateAction(i, { included: e.target.checked })} />
                <Badge>{a.method}</Badge>
                <span className="font-mono text-xs text-faint">{a.path}</span>
              </div>
              {a.included && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <div><label className={label}>Capability key</label><input value={a.key} onChange={(e) => updateAction(i, { key: e.target.value })} className={field} /></div>
                  <div><label className={label}>Display name</label><input value={a.name} onChange={(e) => updateAction(i, { name: e.target.value })} className={field} /></div>
                  <div><label className={label}>Required permission</label><input value={a.requiredPermission} onChange={(e) => updateAction(i, { requiredPermission: e.target.value })} placeholder="e.g. student.results.read" className={field} /></div>
                  <div>
                    <label className={label}>Risk level</label>
                    <select value={a.riskLevel} onChange={(e) => updateAction(i, { riskLevel: e.target.value as DraftAction["riskLevel"] })} className={field}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.requiresConfirm} onChange={(e) => updateAction(i, { requiresConfirm: e.target.checked })} /> Ask for confirmation before running</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={a.requiresStepUp} onChange={(e) => updateAction(i, { requiresStepUp: e.target.checked })} /> Require OTP verification (sensitive data)</label>
                  {a.paramSchema.length > 0 && (
                    <div className="sm:col-span-2 text-[11px] text-faint">Parameters: {a.paramSchema.map((p) => `${p.name} (${p.in})`).join(", ")}</div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {createState?.error && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{createState.error}</div>}
      <div className="flex items-center gap-3">
        <button type="button" onClick={handleBack} className="rounded-xl border border-line px-5 py-2.5 text-sm font-medium text-muted hover:bg-surface-2">
          {backLabel}
        </button>
        <button
          type="submit"
          disabled={creating || includedCount === 0}
          className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          {creating ? "Creating…" : `Create connector with ${includedCount} ${includedCount === 1 ? "capability" : "capabilities"}`}
        </button>
      </div>
    </form>
  );
}
