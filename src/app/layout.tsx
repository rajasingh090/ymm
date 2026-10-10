import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GymPulse AI — your training, made visible",
  description: "A thoughtful workout journal, attendance calendar, and fitness analytics dashboard.",
  applicationName: "GymPulse AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GymPulse" },
};

export const viewport: Viewport = {
  themeColor: "#101310",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
