import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics from node_modules at runtime; don't bundle it.
  // pdf-parse (via pdfjs-dist) tries to spin up a worker script when bundled,
  // which breaks under Turbopack — excluding it preserves pdfjs-dist's normal
  // Node auto-detection (no worker needed for server-side parsing).
  serverExternalPackages: ["pdfkit", "pdf-parse"],
  // Hide the Next.js dev indicator badge (the little "N" in the corner).
  devIndicators: false,
};

export default nextConfig;
