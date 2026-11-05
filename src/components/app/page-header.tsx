import type { ReactNode } from "react";

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
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <span aria-hidden className="bg-brand-metal mb-3 block h-[3px] w-8 rounded-full" />
        <h1 className="font-display text-[40px] leading-[0.95] tracking-[0.02em]">{title}</h1>
        {description && <div className="mt-1 text-[13px] text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
