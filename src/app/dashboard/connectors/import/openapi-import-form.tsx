"use client";

import { useState } from "react";
import { parseOpenApiSpec, type DraftAction } from "@/lib/openapi-import";
import { Card } from "@/components/ui";
import { ConnectorDraftReviewForm } from "../connector-draft-review-form";

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
const label = "text-xs font-medium text-muted";

export function OpenApiImportForm() {
  const [specText, setSpecText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [draft, setDraft] = useState<{ name: string; description: string; baseUrl: string; actions: DraftAction[] } | null>(null);

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
