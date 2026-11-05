import type { ReactNode } from "react";
import { LoginIntroVideo } from "@/components/app/login-intro-video";

/**
 * Écrans d'authentification : panneau noir pur avec la vidéo d'intro
 * (lue une fois, sans son, figée sur la dernière image), formulaire à côté.
 * Un seul lecteur : bandeau en haut sur mobile, colonne gauche sur ordinateur.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="dark grid min-h-screen bg-background text-foreground [color-scheme:dark] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="relative flex items-center justify-center overflow-hidden bg-black lg:shadow-[inset_-1px_0_0_rgb(255_106_0/0.28)]">
        <LoginIntroVideo className="w-72 lg:max-h-screen lg:w-full lg:max-w-[52rem]" />
      </section>
      <section className="flex flex-col items-center justify-center px-4 py-10 lg:py-12">
        <div className="w-full max-w-sm">{children}</div>
      </section>
    </main>
  );
}
