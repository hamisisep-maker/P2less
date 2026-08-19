"use client";

function humanizeKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/\bPct\b/i, "%").replace(/\bMs\b/i, "(ms)").trim();
}

function formatValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "number") return /pct$/i.test(key) ? `${value}%` : String(value);
  return String(value);
}

/** Generic evidence renderer for any `Json?` detail blob — an incident's
 *  detection evidence, a ticket event's structured payload, a payment's
 *  diagnostic trace. Every check/action that adds a new shape to `detail`
 *  gets a reasonable rendering here for free. Two field shapes get special
 *  treatment: an object of counts (e.g. a failure-category breakdown) and an
 *  array of references (e.g. affected transactions). */
export function EvidencePanel({ detail }: { detail: unknown }) {
  if (!detail || typeof detail !== "object") return null;
  const entries = Object.entries(detail as Record<string, unknown>);
  if (entries.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-line-soft bg-surface-2/60 px-3 py-2 text-xs">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {entries.map(([key, value]) => {
          if (Array.isArray(value)) return null; // rendered separately below
          if (value && typeof value === "object") return null; // rendered separately below
          return (
            <div key={key}>
              <span className="text-faint">{humanizeKey(key)}:</span> <span className="font-medium tabular-nums">{formatValue(key, value)}</span>
            </div>
          );
        })}
      </div>
      {entries.map(([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const counts = Object.entries(value as Record<string, number>).sort((a, b) => b[1] - a[1]);
        if (counts.length === 0) return null;
        return (
          <div key={key} className="mt-1.5">
            <span className="text-faint">{humanizeKey(key)}:</span>{" "}
            {counts.map(([cat, n], i) => (
              <span key={cat}>
                {i > 0 && ", "}
                {cat.replace(/_/g, " ")} ({n})
              </span>
            ))}
          </div>
        );
      })}
      {entries.map(([key, value]) => {
        if (!Array.isArray(value) || value.length === 0) return null;
        return (
          <div key={key} className="mt-1.5">
            <span className="text-faint">{humanizeKey(key)} ({value.length}):</span>{" "}
            <span className="font-mono">{value.slice(0, 10).join(", ")}{value.length > 10 ? `, +${value.length - 10} more` : ""}</span>
          </div>
        );
      })}
    </div>
  );
}
