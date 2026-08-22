"use client";

import { useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import type { Audience } from "@/lib/landing-content";

export function AudienceTabs({ audiences }: { audiences: Audience[] }) {
  const [active, setActive] = useState(audiences[0].key);
  const current = audiences.find((a) => a.key === active) ?? audiences[0];

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2">
        {audiences.map((a) => (
          <button
            key={a.key}
            onClick={() => setActive(a.key)}
            className={clsx(
              "rounded-full border px-4 py-2 text-sm font-medium transition-colors",
              active === a.key
                ? "border-transparent bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] text-white shadow-[var(--shadow-accent-glow)]"
                : "border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div key={current.key} className="animate-in mt-8 grid gap-8 rounded-3xl border border-line bg-surface p-7 shadow-[var(--shadow-card)] lg:grid-cols-2 lg:p-10">
        <div>
          <h3 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{current.headline}</h3>
          <p className="mt-3 text-muted">{current.painPoint}</p>
          <Link
            href={current.cta.href}
            className="mt-6 inline-flex rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-5 py-2.5 text-sm font-medium text-white shadow-[var(--shadow-accent-glow)] hover:opacity-90"
          >
            {current.cta.label} →
          </Link>
        </div>
        <ul className="space-y-3">
          {current.capabilities.map((c) => (
            <li key={c} className="flex items-start gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent-ink">✓</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
