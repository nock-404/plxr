import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "plxr",
  description: "A control room for coding CLI sessions",
};

// The skin and the palette ride on <html>: a theme is a token swap, a skin is
// the structural dressing. English is the primary language.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-skin="crt" data-theme="green">
      <body>{children}</body>
    </html>
  );
}
