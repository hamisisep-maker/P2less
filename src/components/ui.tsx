import { clsx } from "clsx";

export function Card({ className, hover = false, children }: { className?: string; hover?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={clsx(
        "rounded-2xl border border-line bg-surface shadow-[var(--shadow-card)] transition-all duration-300",
        hover && "hover:-translate-y-0.5 hover:shadow-[var(--shadow-card-hover)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ tone = "neutral", dot = false, children }: { tone?: "green" | "amber" | "rose" | "neutral" | "accent" | "indigo"; dot?: boolean; children: React.ReactNode }) {
  const tones: Record<string, string> = {
    green: "bg-green-soft text-green",
    amber: "bg-amber-soft text-amber",
    rose: "bg-rose-soft text-rose",
    accent: "bg-accent-soft text-accent-ink",
    indigo: "bg-indigo-soft text-indigo",
    neutral: "bg-surface-2 text-muted",
  };
  const dotTones: Record<string, string> = {
    green: "bg-green", amber: "bg-amber", rose: "bg-rose", accent: "bg-accent-ink", indigo: "bg-indigo", neutral: "bg-faint",
  };
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {dot && <span className={clsx("relative h-1.5 w-1.5 rounded-full", dotTones[tone])}>{(tone === "green" || tone === "accent") && <span className="pulse-dot absolute inset-0" />}</span>}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-faint">{label}</div>
      <div className="mt-1 break-words font-display text-2xl font-bold">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
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
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark, not worth next/image's overhead */}
      <img
        src="/hamzone-logo.png"
        alt="Hamzone Technologies"
        className="h-9 w-9 shrink-0 rounded-xl object-cover shadow-[var(--shadow-accent-glow)]"
      />
      <div className="leading-tight">
        <div className={clsx("font-display font-bold", dark && "text-white")}>P2Less</div>
        <div className={clsx("text-[11px]", dark ? "text-side-text" : "text-faint")}>Conversational Access</div>
      </div>
    </div>
  );
}
