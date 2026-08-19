"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldOff, ShieldCheck, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";
import { suspendTenantAction } from "@/lib/admin-actions";
import { ReasonAction } from "@/components/admin/reason-action";

export type AdminTenantRow = {
  id: string; name: string; industry: string; plan: string; status: string;
  users: number; connectors: number; contacts: number; totalPaidKes: number; lastPaymentAt: Date | null;
};

function ActionCell({ tenant }: { tenant: AdminTenantRow }) {
  const suspended = tenant.status === "suspended";
  return (
    <ReasonAction
      label={
        <span className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
          suspended ? "border-green/30 text-green hover:bg-green-soft" : "border-rose/30 text-rose hover:bg-rose-soft"
        }`}>
          {suspended ? <ShieldCheck size={13} /> : <ShieldOff size={13} />}
          {suspended ? "Reactivate" : "Suspend"}
        </span>
      }
      confirmLabel={suspended ? "Reactivate" : "Suspend"}
      placeholder="Reason (required)…"
      onConfirm={(reason) => suspendTenantAction(tenant.id, !suspended, reason)}
      successMessage={suspended ? `${tenant.name} reactivated` : `${tenant.name} suspended`}
    />
  );
}

const columns: ColumnDef<AdminTenantRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "Organization",
    cell: ({ row }) => (
      <Link href={`/admin/tenants/${row.original.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
        <Avatar name={row.original.name} size={28} />
        {row.original.name}
      </Link>
    ),
  },
  { accessorKey: "industry", header: "Industry", cell: ({ getValue }) => <span className="capitalize text-muted">{getValue() as string}</span> },
  { accessorKey: "plan", header: "Plan", cell: ({ getValue }) => <Badge tone="indigo">{getValue() as string}</Badge> },
  { accessorKey: "status", header: "Status", cell: ({ getValue }) => { const s = getValue() as string; return <Badge tone={s === "active" ? "green" : s === "suspended" ? "rose" : "amber"} dot>{s}</Badge>; } },
  { accessorKey: "totalPaidKes", header: "Total paid", cell: ({ getValue }) => <span className="font-medium">KES {(getValue() as number).toLocaleString("en-US")}</span> },
  { id: "actions", header: "", cell: ({ row }) => <ActionCell tenant={row.original} /> },
];

export function TenantsAdminTable({ data }: { data: AdminTenantRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} className="border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-faint">
                  {h.isPlaceholder ? null : (
                    <button className="flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
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
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
              {r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {table.getPageCount() > 1 && (
        <div className="mt-3 flex items-center justify-end gap-1 text-xs">
          <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="rounded-lg border border-line px-2 py-1 disabled:opacity-30">Prev</button>
          <span className="px-1.5 font-medium">{table.getState().pagination.pageIndex + 1} / {table.getPageCount()}</span>
          <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="rounded-lg border border-line px-2 py-1 disabled:opacity-30">Next</button>
        </div>
      )}
    </div>
  );
}
