import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its font metrics from node_modules at runtime; don't bundle it.
  serverExternalPackages: ["pdfkit"],
  // Hide the Next.js dev indicator badge (the little "N" in the corner).
  devIndicators: false,
};

export default nextConfig;
