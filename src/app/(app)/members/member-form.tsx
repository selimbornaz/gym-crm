"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useFormAction } from "@/components/app/use-form-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/i18n";
import type { MemberRow } from "@/lib/types";
import { createMember, updateMember, type DuplicateCandidate } from "./actions";

/** Formulaire membre (création et modification). */
export function MemberForm({
  member,
  coaches,
}: {
  member?: MemberRow;
  coaches: Array<{ id: string; full_name: string }>;
}) {
  const { state, onSubmit, pending } = useFormAction(member ? updateMember : createMember);
  const errors = state.fieldErrors ?? {};
  const duplicates = (state.data as { duplicates?: DuplicateCandidate[] } | undefined)?.duplicates;

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      {member && <input type="hidden" name="member_id" value={member.id} />}

      <Card>
        <CardHeader>
          <CardTitle>Identité</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Prénom" htmlFor="first_name" error={errors.first_name} required>
            <Input id="first_name" name="first_name" defaultValue={member?.first_name} autoComplete="off" />
          </Field>
          <Field label="Nom" htmlFor="last_name" error={errors.last_name} required>
            <Input id="last_name" name="last_name" defaultValue={member?.last_name} autoComplete="off" />
          </Field>
          <Field label="Date de naissance" htmlFor="birth_date" error={errors.birth_date}>
            <Input id="birth_date" name="birth_date" type="date" defaultValue={member?.birth_date ?? ""} />
          </Field>
          <Field label="Genre" htmlFor="gender" error={errors.gender}>
            <NativeSelect id="gender" name="gender" defaultValue={member?.gender ?? ""}>
              <option value="">Non renseigné</option>
              <option value="female">{t.gender.female}</option>
              <option value="male">{t.gender.male}</option>
              <option value="unspecified">{t.gender.unspecified}</option>
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coordonnées</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Téléphone" htmlFor="phone" error={errors.phone} hint="Ex. +216 22 333 444">
            <Input id="phone" name="phone" type="tel" defaultValue={member?.phone ?? ""} />
          </Field>
          <Field label="Email" htmlFor="email" error={errors.email}>
            <Input id="email" name="email" type="email" defaultValue={member?.email ?? ""} />
          </Field>
          <Field label="Adresse" htmlFor="address" error={errors.address} className="sm:col-span-2">
            <Input id="address" name="address" defaultValue={member?.address ?? ""} />
          </Field>
          <Field label="Contact d'urgence" htmlFor="emergency_contact_name" error={errors.emergency_contact_name}>
            <Input id="emergency_contact_name" name="emergency_contact_name" defaultValue={member?.emergency_contact_name ?? ""} />
          </Field>
          <Field label="Téléphone d'urgence" htmlFor="emergency_contact_phone" error={errors.emergency_contact_phone}>
            <Input id="emergency_contact_phone" name="emergency_contact_phone" type="tel" defaultValue={member?.emergency_contact_phone ?? ""} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Suivi</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Coach assigné" htmlFor="coach_id" error={errors.coach_id} hint="Le coach verra la fiche et pourra créer un programme.">
            <NativeSelect id="coach_id" name="coach_id" defaultValue={member?.coach_id ?? ""}>
              <option value="">Aucun</option>
              {coaches.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </CardContent>
      </Card>

      {duplicates && duplicates.length > 0 && (
        <div role="alert" className="grid gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <p className="flex items-center gap-2 font-medium text-warning">
            <AlertTriangle className="size-4" aria-hidden /> Doublon possible
          </p>
          <ul className="grid gap-1 text-sm">
            {duplicates.map((d) => (
              <li key={d.id}>
                <Link href={`/members/${d.id}`} className="font-medium underline" target="_blank">
                  {d.full_name} ({d.member_code})
                </Link>{" "}
                — {d.match_reason}
                {d.phone && ` · ${d.phone}`}
              </li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm_duplicate" className="size-4" /> Il s&apos;agit d&apos;une autre personne : créer quand même
          </label>
        </div>
      )}

      {!duplicates && <FormMessage state={{ error: state.error }} />}

      <div className="flex justify-end gap-2">
        <Button asChild variant="outline">
          <Link href={member ? `/members/${member.id}` : "/members"}>Annuler</Link>
        </Button>
        <SubmitButton pending={pending}>{member ? "Enregistrer" : "Créer le membre"}</SubmitButton>
      </div>
    </form>
  );
}
