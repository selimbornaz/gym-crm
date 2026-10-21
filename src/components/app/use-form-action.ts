"use client";

import { startTransition, useActionState, type FormEvent } from "react";
import type { ActionState } from "@/lib/action-state";

type ServerAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Soumet un formulaire à une Server Action SANS la réinitialisation
 * automatique de React 19 (`<form action>` vide les champs après chaque envoi,
 * y compris en cas d'erreur de validation : la saisie serait perdue).
 */
export function useFormAction(action: ServerAction) {
  const [state, dispatch, pending] = useActionState(action, {});

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return; // garde-fou anti double-clic
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  }

  return { state, onSubmit, pending };
}
