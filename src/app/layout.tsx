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
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          // Apply the saved theme before paint to avoid a flash of the wrong theme.
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('aegis-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t;}}catch(e){}"
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
