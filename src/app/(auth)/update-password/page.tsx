"use client";

import { useFormAction } from "@/components/app/use-form-action";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { updatePassword } from "../actions";

/** Utilisée après une invitation d'employé ou un lien de réinitialisation. */
export default function UpdatePasswordPage() {
  const { state, onSubmit, pending } = useFormAction(updatePassword);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Choisir un mot de passe</CardTitle>
        <CardDescription>10 caractères minimum, avec au moins une lettre et un chiffre.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Nouveau mot de passe" htmlFor="password" error={state.fieldErrors?.password}>
            <Input id="password" name="password" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirmation" htmlFor="confirm" error={state.fieldErrors?.confirm}>
            <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
          </Field>
          <FormMessage state={{ error: state.error }} />
          <SubmitButton pending={pending}>Enregistrer</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
