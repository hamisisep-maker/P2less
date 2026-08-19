import { clsx } from "clsx";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={clsx("rounded-2xl border border-line bg-surface", className)}>{children}</div>;
}

export function Badge({ tone = "neutral", children }: { tone?: "green" | "amber" | "rose" | "neutral" | "accent"; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: "bg-green-soft text-green",
    amber: "bg-amber-soft text-amber",
    rose: "bg-rose-soft text-rose",
    accent: "bg-accent-soft text-accent-ink",
    neutral: "bg-surface-2 text-muted",
  };
  return <span className={clsx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Compact "3h ago" / "2d ago" style relative time — server-safe (no client
 *  hooks), computed once at render time from a fixed Date. */
export function timeAgo(date: Date): string {
  const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 2592000) return `${Math.floor(s / 86400)}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={clsx("grid h-9 w-9 place-items-center rounded-xl font-mono text-sm font-bold", dark ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-accent text-white")}>
        P2
      </span>
      <div className="leading-tight">
        <div className={clsx("font-semibold", dark && "text-white")}>P2Less</div>
        <div className={clsx("text-[11px]", dark ? "text-white/60" : "text-faint")}>Conversational Access</div>
      </div>
    </div>
  );
}
