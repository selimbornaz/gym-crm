"use client";

import { startTransition, useActionState } from "react";
import { Check, CheckCheck, Megaphone } from "lucide-react";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAnnouncement, markRead } from "./actions";

export function MarkReadButton({ id, all }: { id?: string; all?: boolean }) {
  const [, dispatch, pending] = useActionState(markRead, {});
  return (
    <Button
      size={all ? "default" : "sm"}
      variant={all ? "outline" : "ghost"}
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        if (id) fd.set("notification_id", id);
        startTransition(() => dispatch(fd));
      }}
    >
      {all ? <CheckCheck aria-hidden /> : <Check aria-hidden />}
      {all ? "Tout marquer comme lu" : "Lu"}
    </Button>
  );
}

export function AnnouncementDialog() {
  return (
    <ActionDialog
      trigger={<Button><Megaphone aria-hidden /> Annonce</Button>}
      title="Nouvelle annonce interne"
      description="Visible dans l'application par tout le personnel. Aucun email ni SMS n'est envoyé."
      action={createAnnouncement}
      submitLabel="Publier"
    >
      {(state) => (
        <>
          <Field label="Titre" htmlFor="ann_title" error={state.fieldErrors?.title} required>
            <Input id="ann_title" name="title" />
          </Field>
          <Field label="Message" htmlFor="ann_body" error={state.fieldErrors?.body} required>
            <Textarea id="ann_body" name="body" rows={4} />
          </Field>
        </>
      )}
    </ActionDialog>
  );
}
