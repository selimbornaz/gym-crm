"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

/** Fournisseurs globaux côté client : thème clair/sombre et notifications toast. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <Toaster position="bottom-right" richColors closeButton />
    </ThemeProvider>
  );
}
