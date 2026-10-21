"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, dbErrorMessage, parseForm } from "@/lib/actions";
import type { ActionState } from "@/lib/action-state";
import { uuid } from "@/lib/validation";

/** Marque une ou toutes les notifications de l'utilisateur comme lues (RLS : les siennes uniquement). */
export async function markRead(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("notifications.read");
  if (auth.denied) return auth.denied;
  const id = formData.get("notification_id");
  let query = auth.ctx.supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("organization_id", auth.ctx.org.id)
    .eq("recipient_user_id", auth.ctx.user.id)
    .is("read_at", null);
  if (id) {
    const parsed = uuid.safeParse(id);
    if (!parsed.success) return { error: "Notification invalide." };
    query = query.eq("id", parsed.data);
  }
  const { error } = await query;
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { ok: true, message: id ? undefined : "Toutes les notifications sont marquées comme lues." };
}

export async function createAnnouncement(_: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorize("announcements.manage");
  if (auth.denied) return auth.denied;
  const parsed = parseForm(
    z.object({
      title: z.string().trim().min(2, "Titre requis").max(160),
      body: z.string().trim().min(2, "Message requis").max(4000),
    }),
    formData,
  );
  if (parsed.error) return parsed.error;
  const { error } = await auth.ctx.supabase
    .from("announcements")
    .insert({ ...parsed.data, organization_id: auth.ctx.org.id, created_by: auth.ctx.user.id });
  if (error) return { error: dbErrorMessage(error) };
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
  return { ok: true, message: "Annonce publiée à tout le personnel (dans l'application)." };
}
