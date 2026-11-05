import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Barlow, Bebas_Neue, Geist_Mono } from "next/font/google";
import { dirOf } from "@/i18n";
import { Providers } from "./providers";
import "./globals.css";

// Texte courant : sportif, robuste et très lisible.
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
// Police d'affichage (titres, chiffres clés) : capitales hautes et condensées, très « salle de sport ».
const bebas = Bebas_Neue({ subsets: ["latin"], weight: "400", variable: "--font-bebas", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Dopamine Fitness", template: "%s · Dopamine Fitness" },
  description: "Gestion des membres, abonnements, paiements et présences pour salles de sport.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f2" },
    { media: "(prefers-color-scheme: dark)", color: "#232528" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const locale = "fr";
  return (
    <html lang={locale} dir={dirOf(locale)} className={`${barlow.variable} ${geistMono.variable} ${bebas.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
