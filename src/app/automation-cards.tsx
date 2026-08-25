"use client";

import { useEffect, useRef, useState } from "react";

type Example = { title: string; who: string; says: string; does: string };

// Reveals each card on scroll-into-view (not on mount — this section sits
// well below the fold), staggered left-to-right/top-to-bottom. Within a
// card, the "says" bubble appears first and the "does" reply is held back a
// beat longer, so it reads as an instant reply arriving, not everything
// popping in at once.
export function AutomationCards({ examples }: { examples: Example[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {examples.map((ex, i) => (
        <div
          key={ex.title}
          className="rounded-2xl border border-line bg-surface p-5 transition-all duration-500 motion-reduce:transition-none"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(12px)",
            transitionDelay: visible ? `${i * 90}ms` : "0ms",
          }}
        >
          <div className="font-semibold">{ex.title}</div>
          <div className="mt-3 rounded-xl bg-surface-2 p-3 text-sm">
            <div className="text-xs font-medium text-faint">{ex.who}</div>
            <div className="mt-0.5 italic">&ldquo;{ex.says}&rdquo;</div>
          </div>
          <div
            className="mt-2.5 flex gap-2 text-sm text-muted transition-all duration-500 motion-reduce:transition-none"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(6px)",
              transitionDelay: visible ? `${i * 90 + 450}ms` : "0ms",
            }}
          >
            <span className="text-accent">→</span>
            <span>{ex.does}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
