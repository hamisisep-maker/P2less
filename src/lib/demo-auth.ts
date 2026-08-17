// Shared API-key guard for the simulated external systems. Each demo system has
// its OWN key (proving P2Less authenticates per-connector). These modules are
// used only by /api/demo-*/* route handlers — P2Less reaches them over HTTP.

export function requireKey(req: Request, expected: string): boolean {
  const provided = req.headers.get("x-api-key");
  return !!provided && provided === expected;
}

export function unauthorized(): Response {
  return Response.json({ error: "Invalid or missing API key" }, { status: 401 });
}
