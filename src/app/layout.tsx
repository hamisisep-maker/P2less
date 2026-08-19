import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "P2Less — Conversational Access Platform",
  description: "Stop logging into systems. Start talking to them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { borderRadius: 16, border: "1px solid var(--color-line)", fontSize: 13.5 },
          }}
        />
      </body>
    </html>
  );
}
