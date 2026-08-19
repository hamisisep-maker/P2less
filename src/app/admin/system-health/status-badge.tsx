import { Badge } from "@/components/ui";
import type { CategoryStatus } from "@/lib/system-health";

const EMOJI: Record<CategoryStatus, string> = { healthy: "🟢", degraded: "🟡", unhealthy: "🔴", unknown: "⚪" };
const TONE: Record<CategoryStatus, "green" | "amber" | "rose" | "neutral"> = { healthy: "green", degraded: "amber", unhealthy: "rose", unknown: "neutral" };
const LABEL: Record<CategoryStatus, string> = { healthy: "Healthy", degraded: "Degraded", unhealthy: "Unhealthy", unknown: "No data yet" };

export function StatusBadge({ status }: { status: CategoryStatus }) {
  return <Badge tone={TONE[status]} dot>{EMOJI[status]} {LABEL[status]}</Badge>;
}
