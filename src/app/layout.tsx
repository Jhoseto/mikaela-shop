import type { Metadata } from "next";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/roboto/wght.css";
import "@fontsource-variable/playfair-display/wght.css";
import "@fontsource-variable/playfair-display/wght-italic.css";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Моят Магазин Микаела", template: "%s · Микаела" },
  description:
    "Пазарувай от Моят Магазин Микаела. Виж продуктите, брошурата и възможностите за доставка до дома.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bg">
      <body>{children}</body>
    </html>
  );
}
