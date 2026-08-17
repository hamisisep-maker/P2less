import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "P2Less — Conversational Access Platform",
  description: "Stop logging into systems. Start talking to them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
