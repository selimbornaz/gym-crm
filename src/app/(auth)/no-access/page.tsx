import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { signOut } from "../actions";

/** Compte valide mais rattaché à aucune salle (ou désactivé). */
export default function NoAccessPage() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
        <ShieldX className="size-10 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-semibold">Aucun accès actif</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre compte n&apos;est rattaché à aucune salle ou a été désactivé. Contactez le propriétaire de la salle.
          </p>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline">
            Se déconnecter
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
