import type { ReactNode } from "react";
import { CastleLogo, CastleWordmark } from "@/components/app/castle-logo";
import { t } from "@/i18n";

/** Mise en page des écrans d'authentification : toujours en noir et rouge Castle. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="dark grid min-h-screen bg-background text-foreground [color-scheme:dark] lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <section className="castle-rail relative hidden items-center justify-center overflow-hidden border-r lg:flex">
        <div aria-hidden className="hex-pattern absolute inset-0" />
        <div aria-hidden className="absolute left-1/2 top-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(232_38_42/0.22),transparent)]" />
        <div className="relative flex flex-col items-center">
          <CastleLogo className="logo-breathe h-64" />
          <CastleWordmark className="mt-10 pl-[0.3em] text-3xl" />
          <span aria-hidden className="hairline-brand mt-5 w-48" />
          <p className="mt-5 text-eyebrow">{t.app.tagline}</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center lg:hidden">
            <CastleLogo className="logo-breathe h-24" />
            <CastleWordmark className="mt-4 pl-[0.3em] text-lg" />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
