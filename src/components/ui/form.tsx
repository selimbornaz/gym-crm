"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** Champ de formulaire : libellé, contrôle, aide et message d'erreur reliés (a11y). */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="text-danger"> *</span>}
      </Label>
      {React.isValidElement<Record<string, unknown>>(children)
        ? React.cloneElement(children, { "aria-invalid": !!error || undefined, "aria-describedby": describedBy })
        : children}
      {hint && !error && (
        <p id={`${htmlFor}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Bouton de soumission désactivé pendant l'envoi (évite les doubles soumissions). */
export function SubmitButton({
  children,
  pendingLabel = "Enregistrement…",
  pending: pendingProp,
  ...props
}: ButtonProps & { pendingLabel?: string; pending?: boolean }) {
  const status = useFormStatus();
  const pending = pendingProp ?? status.pending;
  return (
    <Button type="submit" {...props} disabled={pending || props.disabled}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {pending ? pendingLabel : children}
    </Button>
  );
}

/** Message global d'un formulaire (succès ou erreur), annoncé aux lecteurs d'écran. */
export function FormMessage({ state }: { state: { error?: string; message?: string } }) {
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /> {state.message}
      </p>
    );
  }
  return null;
}
