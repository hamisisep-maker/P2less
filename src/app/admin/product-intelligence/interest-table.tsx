"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/dashboard-ui";
import { Badge } from "@/components/ui";
import { Avatar } from "@/components/dashboard-ui";

export type InterestRow = {
  id: string;
  name: string;
  industry: string;
  useCases: string[];
  channelsNeeded: string[];
  exploreCompleted: boolean;
};

const columns: ColumnDef<InterestRow, unknown>[] = [
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
  {
    accessorKey: "useCases",
    header: "Use cases",
    cell: ({ getValue }) => {
      const v = getValue() as string[];
      return v.length ? <div className="flex flex-wrap gap-1">{v.map((u) => <Badge key={u} tone="indigo">{u}</Badge>)}</div> : <span className="text-xs text-faint">None stated</span>;
    },
  },
  {
    accessorKey: "channelsNeeded",
    header: "Channels",
    cell: ({ getValue }) => {
      const v = getValue() as string[];
      return v.length ? <div className="flex flex-wrap gap-1">{v.map((c) => <Badge key={c} tone="accent">{c}</Badge>)}</div> : <span className="text-xs text-faint">None stated</span>;
    },
  },
  {
    accessorKey: "exploreCompleted",
    header: "Explore",
    cell: ({ getValue }) => (getValue() ? <Badge tone="green">completed</Badge> : <Badge tone="neutral">not yet</Badge>),
  },
];

export function InterestTable({ data }: { data: InterestRow[] }) {
  return <DataTable columns={columns} data={data} pageSize={10} searchPlaceholder="Search by organization or industry…" />;
}
