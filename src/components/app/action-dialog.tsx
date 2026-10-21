"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormAction } from "./use-form-action";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/action-state";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Boîte de dialogue reliée à une Server Action :
 *  - validation serveur, erreurs par champ via `children(state)` ;
 *  - fermeture + notification au succès ;
 *  - bouton désactivé pendant l'envoi (pas de double soumission).
 * Sert aussi de dialogue de confirmation pour les actions destructrices.
 */
export function ActionDialog({
  trigger,
  title,
  description,
  action,
  submitLabel = "Enregistrer",
  destructive = false,
  wide = false,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  action: ServerAction;
  submitLabel?: string;
  destructive?: boolean;
  wide?: boolean;
  children?: (state: ActionState) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Clé incrémentée à chaque ouverture : formulaire et état repartent de zéro.
  const [instance, setInstance] = useState(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setInstance((i) => i + 1);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={wide ? "max-w-2xl" : undefined}>
        <DialogForm
          key={instance}
          title={title}
          description={description}
          action={action}
          submitLabel={submitLabel}
          destructive={destructive}
          onDone={() => setOpen(false)}
        >
          {children}
        </DialogForm>
      </DialogContent>
    </Dialog>
  );
}

function DialogForm({
  title,
  description,
  action,
  submitLabel,
  destructive,
  onDone,
  children,
}: {
  title: string;
  description?: ReactNode;
  action: ServerAction;
  submitLabel: string;
  destructive: boolean;
  onDone: () => void;
  children?: (state: ActionState) => ReactNode;
}) {
  const { state, onSubmit, pending } = useFormAction(action);
  // Un même résultat ne doit déclencher qu'une notification, même si le parent se re-rend.
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state.ok && handled.current !== state) {
      handled.current = state;
      if (state.message) toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children?.(state)}
      {!state.ok && <FormMessage state={{ error: state.error }} />}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <SubmitButton pending={pending} variant={destructive ? "destructive" : "default"}>
          {submitLabel}
        </SubmitButton>
      </DialogFooter>
    </form>
  );
}
