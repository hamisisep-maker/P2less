"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { Faq } from "@/lib/landing-content";

export function FaqAccordion({ faqs }: { faqs: Faq[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="space-y-2.5">
      {faqs.map((f, i) => {
        const open = openIndex === i;
        return (
          <div key={f.q} className="rounded-2xl border border-line bg-surface">
            <button
              onClick={() => setOpenIndex(open ? null : i)}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={open}
            >
              <span className="font-medium">{f.q}</span>
              <span className={clsx("shrink-0 text-lg text-faint transition-transform", open && "rotate-45")}>+</span>
            </button>
            {open && <p className="animate-in px-5 pb-4 text-sm text-muted">{f.a}</p>}
          </div>
        );
      })}
    </div>
  );
}
