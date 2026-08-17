import { checkDemoKey, unauthorized } from "@/lib/demo-school";
import { db } from "@/lib/db";

export async function GET(req: Request) {
  if (!checkDemoKey(req)) return unauthorized();
  const next = await db.demoAnnouncement.findFirst({ orderBy: { eventDate: "asc" } });
  if (!next) return Response.json({ error: "No announcements" }, { status: 404 });
  return Response.json({ title: next.title, body: next.body, eventDate: next.eventDate });
}
