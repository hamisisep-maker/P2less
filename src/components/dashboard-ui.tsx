"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownPrimitive from "@radix-ui/react-dropdown-menu";
import {
  Bell, X, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight,
  LogOut, CheckCheck, Info, Clock,
} from "lucide-react";
import { toast } from "sonner";
import {
  AreaChart, Area, PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip,
  XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { clsx } from "clsx";
import { Badge, Card, timeAgo } from "@/components/ui";

// ── Live clock (genuinely ticks — the "everything dynamic" touch in the
// topbar, not a static server-rendered timestamp). ─────────────────────────
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000 * 30);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="h-5 w-40" />; // avoid SSR/client text mismatch flash
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
      <Clock size={13} className="text-faint" />
      {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })} · {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
    </div>
  );
}

// ── Animated count-up number (on mount/value change). No "only run once" ref
// guard — React 18/19 Strict Mode's dev-only double-invoke (mount → cleanup →
// mount) would leave a guard permanently "already started" after the very
// first cleanup, so the count-up would never actually replay and the number
// would sit at 0 forever. Re-running on a genuine remount is harmless (it's a
// cheap cosmetic animation), so there's nothing to guard against. ──────────
export function AnimatedNumber({ value, duration = 900 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(value * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <>{display.toLocaleString("en-US")}</>;
}

// ── Icon stat card (with animated number + trend + tooltip) — the flagship
// stat-card look shared by the tenant Overview and the super-admin page. ───
export function IconStat({ icon, label, value, tip, trend, tone = "accent" }: { icon: React.ReactNode; label: string; value: number; tip?: string; trend?: React.ReactNode; tone?: "accent" | "indigo" | "amber" | "rose" }) {
  const toneClass: Record<string, string> = {
    accent: "bg-[linear-gradient(135deg,var(--color-accent),var(--color-accent-ink))]",
    indigo: "bg-[linear-gradient(135deg,#6366f1,#4338ca)]",
    amber: "bg-[linear-gradient(135deg,#f59e0b,#b45309)]",
    rose: "bg-[linear-gradient(135deg,#fb7185,#be123c)]",
  };
  return (
    <Card hover className="animate-in p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-faint">
          {label}
          {tip && <InfoTip text={tip} />}
        </div>
        <span className={clsx("grid h-9 w-9 place-items-center rounded-xl text-white shadow-[var(--shadow-accent-glow)]", toneClass[tone])}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-[1.7rem] font-bold tabular-nums leading-none"><AnimatedNumber value={value} /></div>
      {trend && <div className="mt-1.5">{trend}</div>}
    </Card>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────
export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="top"
            sideOffset={6}
            className="z-50 max-w-64 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-white shadow-lg animate-in"
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-ink" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────
export function Modal({ trigger, title, description, children }: { trigger: React.ReactNode; title: string; description?: string; children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm data-[state=open]:animate-in" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-line bg-surface p-5 shadow-[var(--shadow-card-hover)] data-[state=open]:animate-in">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <DialogPrimitive.Title className="text-base font-semibold">{title}</DialogPrimitive.Title>
              {description && <DialogPrimitive.Description className="mt-0.5 text-xs text-muted">{description}</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <button className="rounded-lg p-1 text-faint hover:bg-surface-2 hover:text-ink" aria-label="Close">
                <X size={16} />
              </button>
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Avatar (deterministic color from name) ──────────────────────────────────
const AVATAR_TONES = [
  "bg-accent-soft text-accent-ink",
  "bg-indigo/10 text-indigo",
  "bg-amber-soft text-amber",
  "bg-rose-soft text-rose",
  "bg-green-soft text-green",
];
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const tone = AVATAR_TONES[hashStr(name) % AVATAR_TONES.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
  return (
    <div className={clsx("grid shrink-0 place-items-center rounded-full font-semibold", tone)} style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {initials}
    </div>
  );
}

// ── Trend indicator (up/down vs. a previous value) ──────────────────────────
export function Trend({ current, previous }: { current: number; previous: number }) {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return <span className="text-xs font-medium text-faint">flat vs last month</span>;
  const up = pct > 0;
  return (
    <span className={clsx("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-green" : "text-rose")}>
      {up ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      {Math.abs(pct)}% vs last month
    </span>
  );
}

// ── Notification bell ────────────────────────────────────────────────────
export type NotifItem = { id: string; title: string; detail: string; tone: "amber" | "rose" | "accent"; href?: string };
export function NotificationBell({ items }: { items: NotifItem[] }) {
  const [read, setRead] = useState(false);
  const unread = read ? 0 : items.length;
  const toneDot: Record<NotifItem["tone"], string> = { amber: "bg-amber", rose: "bg-rose", accent: "bg-accent" };
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>
        <button className="relative grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface text-muted transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:text-accent-ink hover:shadow-[var(--shadow-card)]" aria-label="Notifications">
          <Bell size={18} />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-rose),#9f1239)] px-1 text-[10px] font-semibold text-white shadow-sm">{unread}</span>
          )}
        </button>
      </DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content align="end" sideOffset={8} className="z-50 w-80 rounded-2xl border border-line bg-surface p-2 shadow-[var(--shadow-card-hover)] data-[state=open]:animate-in">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-sm font-semibold">Notifications</span>
            {items.length > 0 && (
              <button
                onClick={() => { setRead(true); toast.success("All caught up!", { description: "You're all up to date." }); }}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 && <div className="px-2 py-6 text-center text-xs text-muted">Nothing needs your attention 🎉</div>}
            {items.map((it) => (
              <a
                key={it.id}
                href={it.href ?? "#"}
                className="flex items-start gap-2.5 rounded-xl px-2 py-2.5 text-sm hover:bg-surface-2"
              >
                <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", toneDot[it.tone])} />
                <span>
                  <span className="block font-medium">{it.title}</span>
                  <span className="block text-xs text-muted">{it.detail}</span>
                </span>
              </a>
            ))}
          </div>
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

// ── User menu ─────────────────────────────────────────────────────────────
export function UserMenu({ name, orgName, logoutAction }: { name: string; orgName: string; logoutAction: () => Promise<void> }) {
  return (
    <DropdownPrimitive.Root>
      <DropdownPrimitive.Trigger asChild>
        <button className="flex items-center gap-2.5 rounded-xl border border-line bg-surface py-1.5 pl-1.5 pr-3 transition-all hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-[var(--shadow-card)]">
          <Avatar name={name} size={30} />
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-medium">{name}</span>
            <span className="block text-[11px] text-faint">{orgName}</span>
          </span>
        </button>
      </DropdownPrimitive.Trigger>
      <DropdownPrimitive.Portal>
        <DropdownPrimitive.Content align="end" sideOffset={8} className="z-50 w-52 rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-card-hover)] data-[state=open]:animate-in">
          <div className="px-2.5 py-2">
            <div className="text-sm font-medium">{name}</div>
            <div className="text-xs text-faint">{orgName}</div>
          </div>
          <div className="my-1 h-px bg-line" />
          <form action={logoutAction}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rose hover:bg-rose-soft">
              <LogOut size={15} /> Sign out
            </button>
          </form>
        </DropdownPrimitive.Content>
      </DropdownPrimitive.Portal>
    </DropdownPrimitive.Root>
  );
}

// ── Charts ────────────────────────────────────────────────────────────────
const CHART_TICK = { fontSize: 11, fill: "var(--color-faint)" };

export function TrendAreaChart({ data }: { data: { date: string; in: number; out: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="fillIn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillOut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-indigo)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-indigo)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
        <XAxis dataKey="date" tick={CHART_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <RTooltip
          contentStyle={{ borderRadius: 12, border: "1px solid var(--color-line)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="in" name="Messages in" stroke="var(--color-accent)" strokeWidth={2} fill="url(#fillIn)" />
        <Area type="monotone" dataKey="out" name="Messages out" stroke="var(--color-indigo)" strokeWidth={2} fill="url(#fillOut)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const PIE_TONES: Record<string, string> = {
  open: "var(--color-accent)",
  escalated: "var(--color-rose)",
  closed: "var(--color-faint)",
};
export function StatusPieChart({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="grid h-[220px] place-items-center text-sm text-muted">No conversations yet</div>;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={80} paddingAngle={3} strokeWidth={0}>
          {data.map((d) => <Cell key={d.name} fill={PIE_TONES[d.name] ?? "var(--color-faint)"} />)}
        </Pie>
        <RTooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-line)", fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ── Data table (sortable + paginated) ────────────────────────────────────
export function DataTable<T>({ columns, data, pageSize = 6 }: { columns: ColumnDef<T, unknown>[]; data: T[]; pageSize?: number }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data, columns, state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });
  const rows = table.getRowModel().rows;
  const pg = table.getState().pagination;
  const totalRows = data.length;
  const from = totalRows === 0 ? 0 : pg.pageIndex * pg.pageSize + 1;
  const to = Math.min(totalRows, (pg.pageIndex + 1) * pg.pageSize);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-faint">
                    {h.isPlaceholder ? null : (
                      <button
                        className={clsx("flex items-center gap-1", h.column.getCanSort() && "cursor-pointer select-none hover:text-ink")}
                        onClick={h.column.getToggleSortingHandler()}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getCanSort() && (
                          h.column.getIsSorted() === "asc" ? <ChevronUp size={13} /> : h.column.getIsSorted() === "desc" ? <ChevronDown size={13} /> : <ChevronsUpDown size={13} className="text-line" />
                        )}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted">No data yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-3 py-2.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Showing {from}–{to} of {totalRows}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="grid h-7 w-7 place-items-center rounded-lg border border-line disabled:opacity-30 hover:bg-surface-2">
              <ChevronLeft size={14} />
            </button>
            <span className="px-1.5 font-medium text-ink">{pg.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="grid h-7 w-7 place-items-center rounded-lg border border-line disabled:opacity-30 hover:bg-surface-2">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Conversations table (columns include render callbacks, which can only
// exist inside a client component — so this whole table, not just its data,
// lives here rather than being assembled in the server page). ─────────────
export type ConvoRow = { id: string; name: string; channel: string; messages: number; status: string; updated: Date };

const convoColumns: ColumnDef<ConvoRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Contact",
    cell: ({ row }) => (
      <Link href={`/dashboard/conversations/${row.original.id}`} className="flex items-center gap-2.5 font-medium hover:text-accent">
        <Avatar name={row.original.name} size={28} />
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: "channel", header: "Channel", cell: ({ getValue }) => <span className="capitalize text-muted">{getValue() as string}</span> },
  { accessorKey: "messages", header: "Messages" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue }) => {
      const s = getValue() as string;
      return <Badge tone={s === "escalated" ? "rose" : s === "closed" ? "neutral" : "accent"}>{s}</Badge>;
    },
  },
  { accessorKey: "updated", header: "Updated", cell: ({ getValue }) => <span className="text-muted" suppressHydrationWarning>{timeAgo(getValue() as Date)}</span> },
];

export function ConversationsTable({ data, pageSize = 8 }: { data: ConvoRow[]; pageSize?: number }) {
  return <DataTable columns={convoColumns} data={data} pageSize={pageSize} />;
}

// ── Tenants table (super admin) ──────────────────────────────────────────
export type TenantRow = { id: string; name: string; industry: string; plan: string; status: string; users: number; connectors: number; contacts: number };

const tenantColumns: ColumnDef<TenantRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Organization",
    cell: ({ row }) => (
      <span className="flex items-center gap-2.5 font-medium">
        <Avatar name={row.original.name} size={28} />
        {row.original.name}
      </span>
    ),
  },
  { accessorKey: "industry", header: "Industry", cell: ({ getValue }) => <span className="capitalize text-muted">{getValue() as string}</span> },
  { accessorKey: "plan", header: "Plan", cell: ({ getValue }) => <Badge tone="indigo">{getValue() as string}</Badge> },
  { accessorKey: "status", header: "Status", cell: ({ getValue }) => <Badge tone={getValue() === "active" ? "green" : "amber"} dot>{getValue() as string}</Badge> },
  { accessorKey: "users", header: "Staff" },
  { accessorKey: "connectors", header: "Connectors" },
  { accessorKey: "contacts", header: "Contacts" },
];

export function TenantsTable({ data, pageSize = 8 }: { data: TenantRow[]; pageSize?: number }) {
  return <DataTable columns={tenantColumns} data={data} pageSize={pageSize} />;
}

// ── Single-series area chart (platform-wide growth trend) ──────────────────
export function SimpleAreaChart({ data, dataKey, name, color = "var(--color-accent)" }: { data: Record<string, string | number>[]; dataKey: string; name: string; color?: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="fillSimple" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.35} />
            <stop offset="95%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line-soft)" vertical={false} />
        <XAxis dataKey="date" tick={CHART_TICK} axisLine={false} tickLine={false} />
        <YAxis tick={CHART_TICK} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
        <RTooltip contentStyle={{ borderRadius: 12, border: "1px solid var(--color-line)", fontSize: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" }} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2.5} fill="url(#fillSimple)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Orders table (Sales page) ────────────────────────────────────────────
export type OrderRow = { id: string; reference: string; items: string; amount: string; status: string; created: Date };

const orderStatusTone: Record<string, "green" | "amber" | "rose" | "neutral"> = { paid: "green", pending: "amber", failed: "rose", cancelled: "neutral" };
const orderColumns: ColumnDef<OrderRow, unknown>[] = [
  { accessorKey: "reference", header: "Order", cell: ({ getValue }) => <span className="font-mono text-xs font-medium">{getValue() as string}</span> },
  { accessorKey: "items", header: "Items", cell: ({ getValue }) => <span className="text-muted">{getValue() as string}</span> },
  { accessorKey: "amount", header: "Amount", cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
  { accessorKey: "status", header: "Status", cell: ({ getValue }) => { const s = getValue() as string; return <Badge tone={orderStatusTone[s] ?? "neutral"} dot>{s}</Badge>; } },
  { accessorKey: "created", header: "Placed", cell: ({ getValue }) => <span className="text-muted" suppressHydrationWarning>{timeAgo(getValue() as Date)}</span> },
];

export function OrdersTable({ data, pageSize = 8 }: { data: OrderRow[]; pageSize?: number }) {
  return <DataTable columns={orderColumns} data={data} pageSize={pageSize} />;
}

export function InfoTip({ text }: { text: string }) {
  return (
    <Tip content={text}>
      <span className="inline-flex cursor-help text-faint hover:text-muted"><Info size={13} /></span>
    </Tip>
  );
}
