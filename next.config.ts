import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics from node_modules at runtime; don't bundle it.
  // pdf-parse (via pdfjs-dist) tries to spin up a worker script when bundled,
  // which breaks under Turbopack — excluding it preserves pdfjs-dist's normal
  // Node auto-detection (no worker needed for server-side parsing).
  // @whiskeysockets/baileys dynamically imports optional media-processing
  // peer deps (jimp/sharp) wrapped in its own try/catch for when they're not
  // installed — Turbopack still tries to statically resolve them at build
  // time and hard-fails, even though the real code path handles their
  // absence gracefully at runtime. Excluding it here lets Node resolve it
  // normally instead.
  serverExternalPackages: ["pdfkit", "pdf-parse", "@whiskeysockets/baileys"],
  // Hide the Next.js dev indicator badge (the little "N" in the corner).
  devIndicators: false,
};

export default nextConfig;
