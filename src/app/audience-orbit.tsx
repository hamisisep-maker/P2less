import { Store, GraduationCap, Landmark, Building2, Code2 } from "lucide-react";
import type { Audience, AudienceKey } from "@/lib/landing-content";

const ICONS: Record<AudienceKey, typeof Store> = {
  business: Store,
  institutions: GraduationCap,
  sacco: Building2,
  government: Landmark,
  developers: Code2,
};

// Fixed radial layout (no spin) — a static hub with connecting spokes and a
// traveling pulse on each line, standing in for "every organization talks to
// one platform" instead of the generic slowly-rotating badge ring this
// replaced. Positions are hand-placed per audience count (5 today) rather
// than computed from an angle, so the layout reads intentionally, not
// mechanically evenly spaced.
const POSITIONS = [
  { x: 50, y: 8 },    // top
  { x: 88, y: 32 },   // upper right
  { x: 76, y: 78 },   // lower right
  { x: 24, y: 78 },   // lower left
  { x: 12, y: 32 },   // upper left
];

export function AudienceOrbit({ audiences }: { audiences: Audience[] }) {
  return (
    <div className="relative mx-auto h-[300px] w-full max-w-[420px] sm:h-[360px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
        {audiences.map((a, i) => {
          const p = POSITIONS[i % POSITIONS.length];
          return (
            <line
              key={a.key}
              x1="50"
              y1="50"
              x2={p.x}
              y2={p.y}
              stroke="var(--color-line)"
              strokeWidth="0.6"
              strokeDasharray="2 3"
              className="orbit-spoke"
              style={{ animationDelay: `${i * 0.4}s` }}
            />
          );
        })}
      </svg>

      <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface shadow-[var(--shadow-card)] sm:h-20 sm:w-20">
        <div className="text-center">
          <div className="font-display text-base font-bold text-accent-ink sm:text-lg">P2L</div>
          <div className="hidden text-[9px] text-faint sm:block">one platform</div>
        </div>
      </div>

      {audiences.map((a, i) => {
        const p = POSITIONS[i % POSITIONS.length];
        const Icon = ICONS[a.key];
        return (
          <div
            key={a.key}
            className="animate-in absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5"
            style={{ left: `${p.x}%`, top: `${p.y}%`, animationDelay: `${i * 90}ms` }}
          >
            <div className="grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-accent shadow-[var(--shadow-card)] transition-all duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[var(--shadow-card-hover)] sm:h-12 sm:w-12">
              <Icon size={18} strokeWidth={2} />
            </div>
            <div className="whitespace-nowrap text-[11px] font-medium text-muted sm:text-xs">{a.label}</div>
          </div>
        );
      })}
    </div>
  );
}
