"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { NAV } from "@/lib/nav";

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-row gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible">
      {NAV.map(([href, label]) => {
        const active = href === "/dashboard" ? pathname === href : pathname?.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-accent-soft font-medium text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
