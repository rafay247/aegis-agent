import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aegis",
  description: "A research intelligence agent built to retrieve, verify, and synthesize information."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
