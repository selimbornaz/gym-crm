import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Fusionne les classes Tailwind en résolvant les conflits (helper shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const eurFormatter = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Formate un montant en centimes -> "1 234 €". */
export function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/** Formate un ratio 0..1 -> "12,5 %". */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toLocaleString("fr-FR", { maximumFractionDigits: digits })} %`;
}
