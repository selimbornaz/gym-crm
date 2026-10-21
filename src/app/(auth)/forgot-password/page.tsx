"use client";

import Link from "next/link";
import { useFormAction } from "@/components/app/use-form-action";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "../actions";

export default function ForgotPasswordPage() {
  const { state, onSubmit, pending } = useFormAction(requestPasswordReset);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mot de passe oublié</CardTitle>
        <CardDescription>Recevez un lien pour choisir un nouveau mot de passe.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </Field>
          <FormMessage state={state} />
          <SubmitButton pending={pending} pendingLabel="Envoi…">Envoyer le lien</SubmitButton>
          <Link href="/login" className="text-center text-sm text-muted-foreground hover:underline">
            Retour à la connexion
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
