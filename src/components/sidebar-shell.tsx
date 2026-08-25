"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";
import type { NavIconName } from "@/lib/nav";

const STORAGE_KEY = "p2less-sidebar-collapsed";
type NavItem = { href: string; label: string; icon: NavIconName };

/** Wraps SidebarNav with a real collapsed/expanded toggle, persisted per
 *  browser (localStorage — no DB field; this is a display preference, not
 *  data worth syncing across devices). Real gap found in the 2026-08-23 UX
 *  audit: the sidebar was fixed-width with no toggle at all. Starts expanded
 *  on first paint (matches the pre-existing default) and only switches after
 *  reading localStorage on mount — a brief flash back to expanded for a
 *  returning collapsed user is the accepted tradeoff for not blocking first
 *  paint on a synchronous localStorage read. */
export function SidebarShell({ navItems, exactRoot, footer }: { navItems: readonly NavItem[]; exactRoot?: string; footer: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
      return !c;
    });
  }

  return (
    <aside
      className={clsx(
        "flex flex-col border-b border-side-line bg-side-bg transition-[width] duration-150 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r",
        collapsed ? "lg:w-16" : "lg:w-[260px]",
      )}
    >
      <div className={clsx("flex items-center p-5", collapsed ? "lg:justify-center lg:px-0" : "justify-between")}>
        <span
          className={clsx(
            "grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-sm font-bold text-white shadow-[var(--shadow-accent-glow)]",
            "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))]",
          )}
        >
          P2L
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <div className="font-display font-bold text-white">P2Less</div>
            <div className="text-[11px] text-side-text">Conversational Access</div>
          </div>
        )}
        <button
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={clsx("hidden shrink-0 rounded-lg p-1.5 text-side-text/70 hover:bg-white/[0.08] hover:text-side-text-active lg:block", !collapsed && "ml-auto")}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
      </div>
      <SidebarNav items={navItems} exactRoot={exactRoot} collapsed={collapsed} />
      {!collapsed && footer}
    </aside>
  );
}
