"use client";

import { Plus } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { todayInTunis } from "@/lib/format";
import { t } from "@/i18n";
import { saveExpense, voidExpense } from "./actions";

export interface ExpenseValues {
  id: string;
  category: keyof typeof t.expenseCategory;
  amount: number;
  spent_on: string;
  description: string;
  supplier: string | null;
  payment_method_id: string | null;
}

export function ExpenseDialog({ methods, expense }: { methods: Array<{ id: string; label: string }>; expense?: ExpenseValues }) {
  return (
    <ActionDialog
      trigger={expense ? <Button size="sm" variant="ghost">Modifier</Button> : <Button><Plus aria-hidden /> Nouvelle dépense</Button>}
      title={expense ? "Modifier la dépense" : "Nouvelle dépense"}
      action={saveExpense}
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        return (
          <>
            {expense && <input type="hidden" name="expense_id" value={expense.id} />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Catégorie" htmlFor="exp_category" error={e.category} required>
                <NativeSelect id="exp_category" name="category" defaultValue={expense?.category ?? ""}>
                  <option value="" disabled>Choisir…</option>
                  {Object.entries(t.expenseCategory).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Montant (TND)" htmlFor="exp_amount" error={e.amount} required>
                <Input id="exp_amount" name="amount" inputMode="decimal" defaultValue={expense ? String(expense.amount) : ""} />
              </Field>
              <Field label="Date" htmlFor="spent_on" error={e.spent_on} required>
                <Input id="spent_on" name="spent_on" type="date" defaultValue={expense?.spent_on ?? todayInTunis()} />
              </Field>
              <Field label="Moyen de paiement" htmlFor="exp_method" error={e.payment_method_id}>
                <NativeSelect id="exp_method" name="payment_method_id" defaultValue={expense?.payment_method_id ?? ""}>
                  <option value="">—</option>
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </NativeSelect>
              </Field>
            </div>
            <Field label="Description" htmlFor="exp_description" error={e.description} required>
              <Input id="exp_description" name="description" defaultValue={expense?.description} placeholder="Ex. Facture STEG octobre" />
            </Field>
            <Field label="Fournisseur" htmlFor="supplier" error={e.supplier}>
              <Input id="supplier" name="supplier" defaultValue={expense?.supplier ?? ""} />
            </Field>
          </>
        );
      }}
    </ActionDialog>
  );
}

export function VoidExpenseDialog({ expenseId }: { expenseId: string }) {
  return (
    <ActionDialog
      trigger={<Button size="sm" variant="ghost" className="text-danger">Annuler</Button>}
      title="Annuler cette dépense ?"
      description="Elle reste visible (barrée) avec son motif et n'est plus comptée dans les rapports."
      action={voidExpense}
      submitLabel="Annuler la dépense"
      destructive
    >
      {(state) => (
        <>
          <input type="hidden" name="expense_id" value={expenseId} />
          <Field label="Motif" htmlFor={`void-${expenseId}`} error={state.fieldErrors?.reason} required>
            <Textarea id={`void-${expenseId}`} name="reason" rows={2} />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}
