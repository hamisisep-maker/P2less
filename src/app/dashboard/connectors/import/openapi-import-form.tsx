"use client";

import { useEffect, useState } from "react";
import { parseOpenApiSpec, type DraftAction } from "@/lib/openapi-import";
import { Card } from "@/components/ui";
import { ConnectorDraftReviewForm } from "../connector-draft-review-form";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

type Draft = { name: string; description: string; baseUrl: string; actions: DraftAction[] };

// Resume-on-refresh, layer 1 (the paste step + which draft was parsed from
// it). Layer 2 — the admin's per-capability review edits — is handled inside
// ConnectorDraftReviewForm itself. See that file's comment for the full
// rationale; same pattern as /onboard's fix, applied here per the roadmap
// doc's flagged follow-up.
const IMPORT_STORAGE_KEY = "p2less_openapi_import_progress";
type SavedImport = { specText: string; step: "paste" | "review"; draft: Draft | null };

function saveImport(s: SavedImport) {
  try {
    sessionStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage disabled/unavailable — resuming just won't work this time.
  }
}

function loadImport(): SavedImport | null {
  try {
    const raw = sessionStorage.getItem(IMPORT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedImport) : null;
  } catch {
    return null;
  }
}

export function OpenApiImportForm() {
  const [specText, setSpecText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [draft, setDraft] = useState<Draft | null>(null);

  // See connector-draft-review-form.tsx's comment on its own hydrated flag —
  // same race, same fix: a plain ref flip isn't enough since both effects
  // fire in the same commit on mount; gating the save effect on STATE means
  // it only ever runs once the restored values have actually landed.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = loadImport();
    if (saved) {
      setSpecText(saved.specText);
      setStep(saved.step);
      setDraft(saved.draft);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveImport({ specText, step, draft });
  }, [hydrated, specText, step, draft]);

  function handleParse() {
    const result = parseOpenApiSpec(specText);
    if (!result.ok) {
      setParseError(result.error);
      return;
    }
    setParseError(null);
    setDraft({ name: result.suggestedName, description: result.suggestedDescription, baseUrl: result.suggestedBaseUrl, actions: result.actions });
    setStep("review");
  }

  if (step === "paste" || !draft) {
    return (
      <Card className="space-y-4 p-5">
        <div>
          <label className={label}>Paste the OpenAPI (Swagger) spec — raw JSON</label>
          <textarea
            value={specText}
            onChange={(e) => setSpecText(e.target.value)}
            rows={14}
            placeholder='{"openapi":"3.0.0","info":{"title":"..."},"paths":{...}}'
            className={`${field} font-mono text-xs`}
          />
          <p className="mt-1 text-[11px] text-faint">JSON only for now — export/convert a YAML spec to JSON first. Nothing is sent anywhere; this is parsed right here in your browser.</p>
        </div>
        {parseError && <div className="rounded-lg bg-rose-soft px-3 py-2 text-sm text-rose">{parseError}</div>}
        <button
          type="button"
          onClick={handleParse}
          disabled={!specText.trim()}
          className="rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 font-semibold text-white shadow-[var(--shadow-accent-glow)] transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:hover:translate-y-0"
        >
          Parse spec
        </button>
      </Card>
    );
  }

  return (
    <ConnectorDraftReviewForm
      initialName={draft.name}
      initialDescription={draft.description}
      initialBaseUrl={draft.baseUrl}
      initialActions={draft.actions}
      onBack={() => setStep("paste")}
      backLabel="Back to spec"
    />
  );
}
