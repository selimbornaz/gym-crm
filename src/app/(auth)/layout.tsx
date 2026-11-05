import type { ReactNode } from "react";
import { BrandLogo } from "@/components/app/brand-logo";

/**
 * Écrans d'authentification : panneau noir pur (le fond du logo s'y fond),
 * formulaire sur anthracite, accents orange.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="dark grid min-h-screen bg-background text-foreground [color-scheme:dark] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="relative hidden items-center justify-center overflow-hidden bg-black shadow-[inset_-1px_0_0_rgb(255_107_15/0.18)] lg:flex">
        <div aria-hidden className="brand-stripes absolute inset-0" />
        <div className="relative flex flex-col items-center">
          <BrandLogo className="w-[30rem] max-w-[80%]" />
          <span aria-hidden className="hairline-brand mt-6 w-72" />
        </div>
      </section>
      <section className="flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="-mx-4 mb-8 flex justify-center bg-black py-4 lg:hidden">
            <BrandLogo className="w-48" />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
