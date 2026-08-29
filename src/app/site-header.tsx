"use client";

import { useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui";

const NAV_LINKS = [
  { href: "#channels", label: "Channels" },
  { href: "#automation", label: "Automation" },
  { href: "#audience", label: "Who it's for" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

// Below lg, the full nav + all three header links never fit next to the
// logo (found live at 375px: "Dashboard" overlapping the Logo's own
// tagline text) — collapsed into a hamburger menu instead of just letting
// it overflow/wrap awkwardly.
export function SiteHeader() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-[color-mix(in_srgb,var(--color-bg)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Logo />
        <nav className="hidden items-center gap-5 text-sm text-muted lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-ink">{l.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 text-sm lg:flex">
          <Link href="/login" className="rounded-lg px-3 py-1.5 text-muted hover:text-ink">Dashboard</Link>
          <Link href="/demo" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-surface-2">Open the demo</Link>
          <Link href="/onboard" className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3.5 py-1.5 font-medium text-white shadow-[var(--shadow-accent-glow)] hover:opacity-90">Start free</Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href="/onboard" className="rounded-lg bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))] px-3 py-1.5 text-sm font-medium text-white shadow-[var(--shadow-accent-glow)]">Start free</Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-ink"
          >
            {open ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-line-soft bg-[var(--color-bg)] px-6 py-3 text-sm lg:hidden">
          <div className="flex flex-col">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-muted hover:bg-surface-2 hover:text-ink">{l.label}</a>
            ))}
            <div className="my-2 border-t border-line-soft" />
            <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 text-muted hover:bg-surface-2 hover:text-ink">Dashboard</Link>
            <Link href="/demo" onClick={() => setOpen(false)} className="rounded-lg px-2 py-2.5 font-medium text-ink hover:bg-surface-2">Open the demo</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
