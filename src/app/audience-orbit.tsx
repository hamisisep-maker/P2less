import type { Audience } from "@/lib/landing-content";

// Pure-CSS orbit: badges are placed evenly around a circle via a static
// rotate→translate→rotate transform, then the whole ring spins slowly while
// each badge counter-spins at the same speed in the opposite direction — the
// standard trick that keeps every label upright while its POSITION orbits.
// `prefers-reduced-motion` is handled once, globally, in globals.css (same
// convention as widget.js's own pulse/wiggle animations).
export function AudienceOrbit({ audiences }: { audiences: Audience[] }) {
  const n = audiences.length;
  return (
    <div className="orbit-wrap relative mx-auto h-[280px] w-[280px] sm:h-[340px] sm:w-[340px]">
      <div className="grid absolute inset-0 place-items-center rounded-full border border-line bg-surface shadow-[var(--shadow-card)]">
        <div className="text-center">
          <div className="font-display text-lg font-bold text-accent-ink">P2</div>
          <div className="text-[11px] text-faint">one platform</div>
        </div>
      </div>
      <div className="orbit-ring absolute inset-0">
        {audiences.map((a, i) => {
          const angle = (360 / n) * i;
          return (
            <div
              key={a.key}
              className="absolute left-1/2 top-1/2 h-0 w-0"
              style={{ transform: `rotate(${angle}deg) translateX(min(130px,38vw)) rotate(${-angle}deg)` }}
            >
              <div className="orbit-counter -translate-x-1/2 -translate-y-1/2">
                <div className="whitespace-nowrap rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium shadow-[var(--shadow-card)]">
                  {a.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
