import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focus Studio — Prospecting OS",
  description: "Daily prospecting engine for Focus Studio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
