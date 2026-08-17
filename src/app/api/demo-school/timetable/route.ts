import { checkDemoKey, unauthorized } from "@/lib/demo-school";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  if (!checkDemoKey(req)) return unauthorized();
  const url = new URL(req.url);
  const grade = url.searchParams.get("grade") ?? undefined;
  const day = url.searchParams.get("day") ?? undefined;
  const dayMap: Record<string, string> = { today: "monday", tomorrow: "tuesday" };
  const resolvedDay = day ? (dayMap[day] ?? day) : undefined;
  const slots = await db.demoTimetableSlot.findMany({
    where: { grade: grade ?? undefined, day: resolvedDay },
    orderBy: [{ day: "asc" }, { period: "asc" }],
  });
  return Response.json({
    grade, day: resolvedDay,
    slots: slots.map((s) => ({ day: s.day, period: s.period, subject: s.subject })),
    summary: slots.map((s) => `P${s.period} ${s.subject}`).join(", "),
  });
}
