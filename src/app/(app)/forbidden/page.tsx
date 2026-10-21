import Link from "next/link";
import { Lock } from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return (
    <EmptyState
      icon={Lock}
      title="Accès refusé"
      description="Votre rôle ne permet pas d'accéder à cette page. Demandez au propriétaire si vous pensez que c'est une erreur."
      action={
        <Button asChild variant="outline">
          <Link href="/dashboard">Retour au tableau de bord</Link>
        </Button>
      }
    />
  );
}
