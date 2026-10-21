import type { ReactNode } from "react";
import { Dumbbell } from "lucide-react";

/** Mise en page des écrans d'authentification (sans navigation). */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Dumbbell className="size-5" aria-hidden />
          </span>
          Gym CRM
        </div>
        {children}
      </div>
    </main>
  );
}
