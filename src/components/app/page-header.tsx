import type { ReactNode } from "react";

/**
 * En-tête de page : le titre est l'élément fort de l'interface (Archivo élargie,
 * très grasse, grande taille) ; tout le reste autour reste sobre.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 pb-2 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-balance text-[clamp(2.75rem,2rem+2.6vw,4.5rem)] leading-[0.9]">{title}</h1>
        {description && <div className="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
    </header>
  );
}
