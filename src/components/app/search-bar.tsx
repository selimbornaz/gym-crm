import type { ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Barre de recherche/filtres par formulaire GET : l'état vit dans l'URL
 * (partageable, bouton retour fonctionnel, rendu serveur, pas de JS requis).
 */
export function SearchBar({
  placeholder = "Rechercher…",
  defaultValue,
  children,
  resetHref,
}: {
  placeholder?: string;
  defaultValue?: string;
  children?: ReactNode;
  resetHref?: string;
}) {
  return (
    <form method="get" className="flex flex-wrap items-center gap-2" role="search">
      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input name="q" type="search" placeholder={placeholder} aria-label={placeholder} defaultValue={defaultValue} className="bg-card pl-8" />
      </div>
      {children}
      <Button type="submit" variant="secondary">
        Filtrer
      </Button>
      {resetHref && (
        <Button asChild variant="ghost">
          <Link href={resetHref}>Réinitialiser</Link>
        </Button>
      )}
    </form>
  );
}
