import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Saira } from "next/font/google";
import { dirOf } from "@/i18n";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
// Police d'affichage (titres, nom de la salle, chiffres clés) : géométrique et sportive comme le logo.
const saira = Saira({ subsets: ["latin"], variable: "--font-saira", display: "swap" });

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
    <html lang={locale} dir={dirOf(locale)} className={`${geistSans.variable} ${geistMono.variable} ${saira.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
