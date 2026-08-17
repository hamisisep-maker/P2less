import { getDocumentByToken } from "@/lib/documents";

// Secure, temporary document delivery. The token is unguessable and the document
// expires; access is by possession of the link only (as delivered to the
// authorized contact). In production this proxies a signed object-storage URL.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await getDocumentByToken(token);
  if (!found) return new Response("Document not found", { status: 404 });
  if (found.expired) return new Response("This document link has expired.", { status: 410 });
  // PDFs are stored base64-encoded; serve them as real files. Everything else is HTML.
  if (found.doc.filename.endsWith(".pdf")) {
    const bytes = Buffer.from(found.doc.content, "base64");
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${found.doc.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return new Response(found.doc.content, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
