import { db } from "./db";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers for the DEMO EXTERNAL school system. This module is used ONLY by the
// /api/demo-school/* route handlers — it stands in for a third-party school
// management system with its own database and its own API-key auth. P2Less never
// imports this; it reaches these routes over HTTP through a Connector.
// ─────────────────────────────────────────────────────────────────────────────

/** Validate the external system's API key. Returns true if authorized. */
export function checkDemoKey(req: Request): boolean {
  const provided = req.headers.get("x-api-key");
  const expected = process.env.DEMO_SCHOOL_API_KEY || "demo-school-api-key-riverside";
  return !!provided && provided === expected;
}

export function unauthorized(): Response {
  return Response.json({ error: "Invalid or missing API key" }, { status: 401 });
}

export async function findStudent(externalId: string) {
  return db.demoStudent.findUnique({
    where: { externalId },
    include: { results: true, fees: true, attendance: true },
  });
}
