"use client";

import { useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, getPaginationRowModel,
  flexRender, type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import { ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge, timeAgo } from "@/components/ui";

export type PaymentRow = {
  id: string; reference: string; tenantName: string; amount: number; currency: string;
  method: string; purpose: string; status: string; provider: string | null; createdAt: Date;
};

const statusTone: Record<string, "green" | "amber" | "rose" | "neutral"> = { paid: "green", pending: "amber", failed: "rose", refunded: "neutral" };

const columns: ColumnDef<PaymentRow, unknown>[] = [
  { accessorKey: "reference", header: "Reference", cell: ({ getValue }) => <span className="font-mono text-xs font-medium">{getValue() as string}</span> },
  { accessorKey: "tenantName", header: "Organization" },
  { accessorKey: "amount", header: "Amount", cell: ({ row }) => <span className="font-medium">{row.original.currency} {row.original.amount.toLocaleString("en-US")}</span> },
  { accessorKey: "purpose", header: "Purpose", cell: ({ getValue }) => <span className="capitalize text-muted">{getValue() as string}</span> },
  { accessorKey: "method", header: "Method", cell: ({ getValue }) => <span className="uppercase text-muted">{getValue() as string}</span> },
  { accessorKey: "status", header: "Status", cell: ({ getValue }) => { const s = getValue() as string; return <Badge tone={statusTone[s] ?? "neutral"} dot>{s}</Badge>; } },
  { accessorKey: "createdAt", header: "Date", cell: ({ getValue }) => <span className="text-muted">{timeAgo(getValue() as Date)}</span> },
];

export function PaymentsTable({ data }: { data: PaymentRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: "createdAt", desc: true }]);
  const table = useReactTable({
    data, columns, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 10 } },
  });
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b border-line px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-faint">
                    <button className="flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {h.column.getIsSorted() === "asc" ? <ChevronUp size={13} /> : h.column.getIsSorted() === "desc" ? <ChevronDown size={13} /> : <ChevronsUpDown size={13} className="text-line" />}
                    </button>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 && <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted">No payments recorded yet.</td></tr>}
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-surface-2">
                {r.getVisibleCells().map((c) => <td key={c.id} className="px-3 py-2.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <span>{data.length} payment{data.length === 1 ? "" : "s"} total — this is your forensic record for any payment dispute.</span>
          <div className="flex items-center gap-1">
            <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} className="grid h-7 w-7 place-items-center rounded-lg border border-line disabled:opacity-30"><ChevronLeft size={14} /></button>
            <span className="px-1.5 font-medium text-ink">{table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}</span>
            <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} className="grid h-7 w-7 place-items-center rounded-lg border border-line disabled:opacity-30"><ChevronRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
