import type { Metadata } from "next";
import { IM_Fell_English, Source_Serif_4 } from "next/font/google";

import { AfterMount } from "@/components/after-mount";
import { LocaleProvider } from "@/components/locale";
import { Shell } from "@/components/shell";

import "./globals.css";

/** Classic bookish body for nav, list rows, paragraphs, and form text. */
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

/** Display face for titles, section headings, and the brand wordmark. */
const fell = IM_Fell_English({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MnM Loot Splitter",
  description: "Local Monsters & Memories loot register and group splitter, read from the client Ledger logs, with resale prices.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sourceSerif.variable} ${fell.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AfterMount>
          <LocaleProvider>
            <Shell>{children}</Shell>
          </LocaleProvider>
        </AfterMount>
      </body>
    </html>
  );
}
