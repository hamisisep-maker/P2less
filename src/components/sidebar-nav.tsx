"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { NAV } from "@/lib/nav";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/dashboard" ? pathname === href : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "group relative flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-white/[0.08] text-side-text-active"
                : "text-side-text hover:bg-white/[0.05] hover:text-side-text-active",
            )}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-[linear-gradient(180deg,var(--color-accent),var(--color-accent-2))]" />}
            <Icon size={17} className={clsx("shrink-0 transition-colors", active ? "text-accent" : "text-side-text/70 group-hover:text-side-text-active")} strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
