import { Badge } from "@/components/ui";

function Node({ label, ok }: { label: string; ok: boolean | null }) {
  const tone = ok === true ? "green" : ok === false ? "rose" : "neutral";
  return (
    <div className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-sm font-medium">
      {label}
      <Badge tone={tone} dot>{ok === true ? "up" : ok === false ? "down" : "n/a"}</Badge>
    </div>
  );
}

/** Deliberately simple — a static layout with LIVE status badges pulled from
 *  the same Integration rows the rest of this page reads, not a second data
 *  source. "Start simple" per the spec; the point is showing blast radius
 *  (if M-Pesa fails, Billing/Usage/Audit are affected, WhatsApp itself isn't). */
export function DependencyMap({ mpesaOk, whatsappOk, aiOk, dbOk }: { mpesaOk: boolean | null; whatsappOk: boolean | null; aiOk: boolean; dbOk: boolean | null }) {
  return (
    <div className="flex flex-col items-center gap-2 py-2 text-center">
      <Node label="Tenant" ok={null} />
      <div className="text-faint">↓</div>
      <Node label="WhatsApp" ok={whatsappOk} />
      <div className="text-faint">↓</div>
      <Node label="Application" ok={dbOk} />
      <div className="flex flex-wrap items-center justify-center gap-6 text-faint">
        <span>↙</span><span>↓</span><span>↘</span>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Node label="AI" ok={aiOk} />
        <Node label="M-Pesa" ok={mpesaOk} />
        <Node label="Database" ok={dbOk} />
      </div>
      <div className="text-faint">↓</div>
      <Node label="Billing / Usage / Audit" ok={dbOk} />
    </div>
  );
}
