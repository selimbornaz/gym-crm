"use client";

import Link from "next/link";
import { useFormAction } from "@/components/app/use-form-action";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signIn } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  const { state, onSubmit, pending } = useFormAction(signIn);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connexion</CardTitle>
        <CardDescription>Accès réservé au personnel de la salle.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Email" htmlFor="email" error={state.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
          </Field>
          <Field label="Mot de passe" htmlFor="password" error={state.fieldErrors?.password}>
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <FormMessage state={{ error: state.error }} />
          <SubmitButton pending={pending} pendingLabel="Connexion…">Se connecter</SubmitButton>
          <Link href="/forgot-password" className="text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
            Mot de passe oublié ?
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
