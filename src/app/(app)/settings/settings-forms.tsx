"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { useFormAction } from "@/components/app/use-form-action";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { PaymentMethodRow, PlanRow } from "@/lib/types";
import { t } from "@/i18n";
import { savePaymentMethod, savePlan, updateOrganization, updateSettings } from "./actions";

type Org = Record<string, string | null> | null;

export function OrganizationForm({ org }: { org: Org }) {
  const { state, onSubmit, pending } = useFormAction(updateOrganization);
  const e = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom commercial" htmlFor="name" error={e.name} required>
          <Input id="name" name="name" defaultValue={org?.name ?? ""} />
        </Field>
        <Field label="Raison sociale" htmlFor="legal_name" error={e.legal_name}>
          <Input id="legal_name" name="legal_name" defaultValue={org?.legal_name ?? ""} />
        </Field>
        <Field label="Matricule fiscal" htmlFor="tax_id" error={e.tax_id}>
          <Input id="tax_id" name="tax_id" defaultValue={org?.tax_id ?? ""} />
        </Field>
        <Field label="Téléphone" htmlFor="org_phone" error={e.phone}>
          <Input id="org_phone" name="phone" defaultValue={org?.phone ?? ""} />
        </Field>
        <Field label="Email" htmlFor="org_email" error={e.email}>
          <Input id="org_email" name="email" type="email" defaultValue={org?.email ?? ""} />
        </Field>
        <Field label="Adresse" htmlFor="org_address" error={e.address}>
          <Input id="org_address" name="address" defaultValue={org?.address ?? ""} />
        </Field>
      </div>
      <Field label="Pied de reçu" htmlFor="receipt_footer" error={e.receipt_footer}>
        <Textarea id="receipt_footer" name="receipt_footer" rows={2} defaultValue={org?.receipt_footer ?? ""} placeholder="Merci de votre confiance." />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="justify-self-end">Enregistrer</SubmitButton>
    </form>
  );
}

const NOTIFY_TYPES = Object.keys(t.notificationType) as Array<keyof typeof t.notificationType>;

export function SettingsForm({ settings }: { settings: Record<string, unknown> | null }) {
  const { state, onSubmit, pending } = useFormAction(updateSettings);
  const e = state.fieldErrors ?? {};
  const enabled = new Set((settings?.notify_types as string[] | undefined) ?? []);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Alerte d'expiration (jours avant)" htmlFor="expiry_alert_days" error={e.expiry_alert_days}>
          <Input id="expiry_alert_days" name="expiry_alert_days" type="number" min={1} max={60} defaultValue={String(settings?.expiry_alert_days ?? 7)} />
        </Field>
        <Field label="Anti double-scan (minutes)" htmlFor="checkin_debounce_minutes" error={e.checkin_debounce_minutes} hint="Un 2e passage dans ce délai n'est pas compté.">
          <Input id="checkin_debounce_minutes" name="checkin_debounce_minutes" type="number" min={0} max={240} defaultValue={String(settings?.checkin_debounce_minutes ?? 5)} />
        </Field>
        <Field label="Préfixe des reçus" htmlFor="receipt_prefix" error={e.receipt_prefix}>
          <Input id="receipt_prefix" name="receipt_prefix" defaultValue={String(settings?.receipt_prefix ?? "R")} />
        </Field>
        <Field label="Préfixe des n° membres" htmlFor="member_code_prefix" error={e.member_code_prefix} hint="S'applique aux nouveaux membres.">
          <Input id="member_code_prefix" name="member_code_prefix" defaultValue={String(settings?.member_code_prefix ?? "M")} />
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Notifications dans l&apos;application</legend>
        {NOTIFY_TYPES.map((type) => (
          <label key={type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="notify_types[]" value={type} defaultChecked={enabled.has(type)} className="size-4" />
            {t.notificationType[type]}
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-2 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Canaux externes</legend>
        {["Email", "SMS", "WhatsApp"].map((c) => (
          <p key={c} className="flex items-center justify-between text-sm">
            {c} <span className="text-xs text-muted-foreground">Non configuré — aucun message n&apos;est envoyé</span>
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          L&apos;intégration d&apos;un fournisseur (ex. SMTP, Twilio, WhatsApp Cloud API) est prévue dans l&apos;architecture : voir le README.
        </p>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton pending={pending} className="justify-self-end">Enregistrer</SubmitButton>
    </form>
  );
}

export function PlanDialog({ plan }: { plan?: PlanRow }) {
  return (
    <ActionDialog
      trigger={plan ? <Button size="sm" variant="ghost">Modifier</Button> : <Button><Plus aria-hidden /> Nouvelle formule</Button>}
      title={plan ? `Modifier « ${plan.name} »` : "Nouvelle formule"}
      description="Un changement de prix ne modifie pas les abonnements déjà vendus."
      action={savePlan}
      wide
    >
      {(state) => <PlanFields plan={plan} errors={state.fieldErrors ?? {}} />}
    </ActionDialog>
  );
}

function PlanFields({ plan, errors: e }: { plan?: PlanRow; errors: Record<string, string> }) {
  const [kind, setKind] = useState<PlanRow["kind"]>(plan?.kind ?? "membership");
  return (
    <>
      {plan && <input type="hidden" name="plan_id" value={plan.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom" htmlFor="plan_name" error={e.name} required>
          <Input id="plan_name" name="name" defaultValue={plan?.name} placeholder="Ex. Trimestriel" />
        </Field>
        <Field label="Type" htmlFor="plan_kind" error={e.kind}>
          <NativeSelect id="plan_kind" name="kind" value={kind} onChange={(ev) => setKind(ev.target.value as PlanRow["kind"])}>
            {(Object.keys(t.planKind) as PlanRow["kind"][]).map((k) => (
              <option key={k} value={k}>{t.planKind[k]}</option>
            ))}
          </NativeSelect>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Durée" htmlFor="duration_value" error={e.duration_value} required>
            <Input id="duration_value" name="duration_value" type="number" min={1} defaultValue={plan?.duration_value ?? 1} />
          </Field>
          <Field label="Unité" htmlFor="duration_unit" error={e.duration_unit}>
            <NativeSelect id="duration_unit" name="duration_unit" defaultValue={plan?.duration_unit ?? "month"}>
              {(Object.keys(t.durationUnit) as PlanRow["duration_unit"][]).map((u) => (
                <option key={u} value={u}>{t.durationUnit[u]}</option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Prix (TND)" htmlFor="plan_price" error={e.price} required>
          <Input id="plan_price" name="price" inputMode="decimal" defaultValue={plan ? String(plan.price) : ""} />
        </Field>
        {kind === "pt_package" && (
          <Field label="Séances incluses" htmlFor="sessions_included" error={e.sessions_included} required>
            <Input id="sessions_included" name="sessions_included" type="number" min={1} defaultValue={plan?.sessions_included ?? 10} />
          </Field>
        )}
        <Field label="Ordre d'affichage" htmlFor="sort_order" error={e.sort_order}>
          <Input id="sort_order" name="sort_order" type="number" min={0} defaultValue={plan?.sort_order ?? 0} />
        </Field>
      </div>
      <Field label="Restrictions d'accès (optionnel)" htmlFor="access_restrictions" error={e.access_restrictions} hint="Affichées à l'accueil lors du check-in.">
        <Input id="access_restrictions" name="access_restrictions" defaultValue={plan?.access_restrictions ?? ""} placeholder="Ex. Accès 6h–16h, hors week-end" />
      </Field>
      <Field label="Description" htmlFor="plan_description" error={e.description}>
        <Textarea id="plan_description" name="description" rows={2} defaultValue={plan?.description ?? ""} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="is_active" defaultChecked={plan?.is_active ?? true} className="size-4" /> Formule proposée à la vente
      </label>
    </>
  );
}

export function MethodDialog({ method }: { method?: PaymentMethodRow }) {
  return (
    <ActionDialog
      trigger={method ? <Button size="sm" variant="ghost">Modifier</Button> : <Button><Plus aria-hidden /> Nouveau moyen</Button>}
      title={method ? "Modifier le moyen de paiement" : "Nouveau moyen de paiement"}
      action={savePaymentMethod}
    >
      {(state) => (
        <>
          {method && <input type="hidden" name="method_id" value={method.id} />}
          <Field label="Nom" htmlFor="method_name" error={state.fieldErrors?.name} required>
            <Input id="method_name" name="name" defaultValue={method?.name} placeholder="Ex. D17, Flouci…" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={method?.is_active ?? true} className="size-4" /> Actif
          </label>
        </>
      )}
    </ActionDialog>
  );
}
