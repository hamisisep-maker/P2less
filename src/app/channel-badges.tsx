import type { Channel } from "@/lib/landing-content";

// Simple styled monogram marks in each platform's real brand color — not
// scraped/trademarked logo assets, the same legitimate "works with" pattern
// most integration pages use. Ties back to the Logo component's own
// two-letter monogram treatment, so it reads as one consistent visual system.
export function ChannelBadges({ channels }: { channels: Channel[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {channels.map((c) => (
        <div key={c.name} className="relative rounded-2xl border border-line bg-surface p-4 text-center">
          {!c.live && (
            <span className="absolute right-2 top-2 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-faint">soon</span>
          )}
          <div
            className="mx-auto grid h-11 w-11 place-items-center rounded-xl text-sm font-bold text-white"
            style={{ background: c.color }}
          >
            {c.mark}
          </div>
          <div className="mt-2 text-sm font-semibold">{c.name}</div>
          <div className="mt-0.5 text-xs text-muted">{c.blurb}</div>
        </div>
      ))}
    </div>
  );
}
