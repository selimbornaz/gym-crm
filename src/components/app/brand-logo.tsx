import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Logo officiel Dopamine Fitness, affiché tel quel (fichier d'origine, fond noir,
 * jamais recadré ni retouché) : seule sa taille change selon l'emplacement.
 */
export function BrandLogo({ className, title = "Dopamine Fitness" }: { className?: string; title?: string }) {
  return (
    <Image
      src="/brand/dopamine-fitness.webp"
      alt={title}
      width={2000}
      height={2000}
      priority
      className={cn("aspect-square h-auto w-64 shrink-0 bg-black object-contain", className)}
    />
  );
}
