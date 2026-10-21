"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/app/action-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { InitialsAvatar } from "@/components/ui/avatar";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { formatDateTime } from "@/lib/format";
import { addMemberNote, archiveMember, deleteMemberNote, setMemberPhoto } from "../actions";

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Photo du membre. Le fichier part directement vers Supabase Storage avec la
 * session de l'utilisateur : la politique de stockage vérifie que le chemin
 * commence par l'id de SA salle et qu'il a le droit `members.write`.
 */
export function MemberPhoto({
  memberId,
  orgId,
  photoUrl,
  canEdit,
  name,
}: {
  memberId: string;
  orgId: string;
  photoUrl: string | null;
  canEdit: boolean;
  name: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    if (!ACCEPTED.includes(file.type)) return toast.error("Format accepté : JPEG, PNG ou WebP.");
    if (file.size > MAX_BYTES) return toast.error("Image trop lourde (2 Mo maximum).");
    setBusy(true);
    try {
      const ext = file.type.split("/")[1];
      const path = `${orgId}/${memberId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await createBrowserSupabase().storage.from("member-photos").upload(path, file, { contentType: file.type });
      if (error) throw new Error("Envoi refusé.");
      const result = await setMemberPhoto(memberId, path);
      if (result.error) throw new Error(result.error);
      toast.success("Photo mise à jour.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire
        <img src={photoUrl} alt={`Photo de ${name}`} className="size-28 rounded-full border object-cover" />
      ) : (
        <InitialsAvatar name={name} className="size-28 text-2xl" />
      )}
      {canEdit && (
        <>
          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(",")}
            className="sr-only"
            aria-label="Choisir une photo"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="absolute bottom-0 right-0 rounded-full border"
            onClick={() => input.current?.click()}
            disabled={busy}
            aria-label="Changer la photo"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
          </Button>
        </>
      )}
    </div>
  );
}

export function ArchiveMemberButton({ memberId, archived, name }: { memberId: string; archived: boolean; name: string }) {
  return (
    <ActionDialog
      trigger={
        <Button size="sm" variant="ghost" className={archived ? undefined : "text-danger"}>
          {archived ? "Restaurer" : "Archiver"}
        </Button>
      }
      title={archived ? `Restaurer ${name} ?` : `Archiver ${name} ?`}
      description={
        archived
          ? "Le membre réapparaît dans les listes."
          : "Le membre disparaît des listes et ne peut plus entrer. Tout l'historique est conservé."
      }
      action={archiveMember}
      submitLabel={archived ? "Restaurer" : "Archiver"}
      destructive={!archived}
    >
      {(state) => (
        <>
          <input type="hidden" name="member_id" value={memberId} />
          <input type="hidden" name="archive" value={archived ? "false" : "true"} />
          {!archived && (
            <Field label="Motif" htmlFor="archive_reason" error={state.fieldErrors?.reason} required>
              <Textarea id="archive_reason" name="reason" rows={2} placeholder="Ex. a déménagé" />
            </Field>
          )}
        </>
      )}
    </ActionDialog>
  );
}

export function MemberNotes({
  memberId,
  currentUserId,
  notes,
}: {
  memberId: string;
  currentUserId: string;
  notes: Array<{ id: string; body: string; created_at: string; created_by: string | null }>;
}) {
  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted-foreground">Visibles uniquement par le propriétaire et l&apos;accueil. N&apos;y consignez pas de données de santé.</p>
      <ActionDialog trigger={<Button variant="outline" className="justify-self-start">Ajouter une note</Button>} title="Note interne" action={addMemberNote}>
        {(state) => (
          <>
            <input type="hidden" name="member_id" value={memberId} />
            <Field label="Note" htmlFor="note_body" error={state.fieldErrors?.body} required>
              <Textarea id="note_body" name="body" rows={4} />
            </Field>
          </>
        )}
      </ActionDialog>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune note.</p>
      ) : (
        <ul className="grid gap-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border bg-card p-3 text-sm">
              <p className="whitespace-pre-line">{n.body}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <time dateTime={n.created_at}>{formatDateTime(n.created_at)}</time>
                {n.created_by === currentUserId && (
                  <ActionDialog
                    trigger={<Button size="sm" variant="ghost" aria-label="Supprimer la note"><Trash2 /></Button>}
                    title="Supprimer cette note ?"
                    action={deleteMemberNote}
                    submitLabel="Supprimer"
                    destructive
                  >
                    {() => (
                      <>
                        <input type="hidden" name="note_id" value={n.id} />
                        <input type="hidden" name="member_id" value={memberId} />
                      </>
                    )}
                  </ActionDialog>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
