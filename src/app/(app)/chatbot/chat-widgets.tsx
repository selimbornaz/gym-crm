"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Hand, Loader2, Lock, RotateCcw, Send, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useFormAction } from "@/components/app/use-form-action";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { ChatbotSettings, ChatStatus } from "@/lib/chatbot/types";
import { cn } from "@/lib/utils";
import {
  connectChannelAccount,
  saveChatbotSettings,
  sendStaffReply,
  simulatorReset,
  simulatorSend,
  updateChannelAccount,
  updateConversation,
} from "./actions";

/** Rafraîchit la page (nouveaux messages) tant qu'elle est visible. */
export function AutoRefresh({ intervalMs = 6000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [router, intervalMs]);
  return null;
}

/** Fait défiler le fil jusqu'au dernier message. */
export function ScrollToEnd({ trigger }: { trigger: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ block: "end" }), [trigger]);
  return <div ref={ref} />;
}

/** Marque la conversation comme lue à l'ouverture. */
export function MarkRead({ conversationId, unread }: { conversationId: string; unread: number }) {
  const done = useRef(false);
  useEffect(() => {
    if (unread === 0 || done.current) return;
    done.current = true;
    const fd = new FormData();
    fd.set("conversation_id", conversationId);
    fd.set("action", "read");
    void updateConversation({}, fd);
  }, [conversationId, unread]);
  return null;
}

/** Zone de réponse de l'équipe (Entrée envoie, Maj+Entrée va à la ligne). */
export function Composer({ conversationId, channelLabel }: { conversationId: string; channelLabel: string }) {
  const { state, onSubmit, pending } = useFormAction(sendStaffReply);
  const form = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState("");
  const lastState = useRef(state);

  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok) setValue("");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form ref={form} onSubmit={onSubmit} className="flex items-end gap-2 border-t bg-card/60 p-3">
      <input type="hidden" name="conversation_id" value={conversationId} />
      <label htmlFor="reply" className="sr-only">Votre réponse</label>
      <Textarea
        id="reply"
        name="body"
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) form.current?.requestSubmit();
          }
        }}
        placeholder={`Répondre sur ${channelLabel}… (le bot se met en pause)`}
        className="min-h-11 resize-none"
      />
      <Button type="submit" size="icon" className="size-11 shrink-0" disabled={pending || !value.trim()} aria-label="Envoyer">
        {pending ? <Loader2 className="animate-spin" /> : <Send />}
      </Button>
    </form>
  );
}

/** Reprendre la main / rendre au bot / clore. */
export function ConversationActions({ conversationId, status }: { conversationId: string; status: ChatStatus }) {
  const [pending, start] = useTransition();
  const run = (action: string) =>
    start(async () => {
      const fd = new FormData();
      fd.set("conversation_id", conversationId);
      fd.set("action", action);
      const r = await updateConversation({}, fd);
      if (r.error) toast.error(r.error);
    });
  return (
    <div className="flex flex-wrap gap-1.5">
      {status !== "human" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("take_over")}>
          <Hand aria-hidden /> Reprendre la main
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run("give_back")}>
          <Bot aria-hidden /> Rendre au bot
        </Button>
      )}
      {status !== "closed" && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("close")}>
          <XCircle aria-hidden /> Clore
        </Button>
      )}
    </div>
  );
}

/** Réglages du bot (propriétaire). */
export function SettingsForm({ settings }: { settings: ChatbotSettings }) {
  const { state, onSubmit, pending } = useFormAction(saveChatbotSettings);
  const fe = state.fieldErrors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <label className="flex items-center justify-between gap-3 rounded-xl border bg-secondary/40 p-4">
        <span>
          <span className="block text-[14px] font-semibold">Chatbot activé</span>
          <span className="block text-[12px] text-muted-foreground">Désactivé : les messages arrivent dans la boîte de réception, sans réponse automatique.</span>
        </span>
        <input type="checkbox" name="enabled" defaultChecked={settings.enabled} className="size-5" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nom du bot" htmlFor="bot_name" error={fe.bot_name} required>
          <Input id="bot_name" name="bot_name" defaultValue={settings.bot_name} maxLength={60} />
        </Field>
        <Field label="Ton des réponses" htmlFor="tone" error={fe.tone} required>
          <Input id="tone" name="tone" defaultValue={settings.tone} maxLength={200} />
        </Field>
      </div>
      <Field
        label="Ce que le bot doit savoir"
        htmlFor="knowledge"
        error={fe.knowledge}
        hint="Horaires, cours proposés, règles de la salle, parking, promotions, questions fréquentes… Les prix des formules sont lus automatiquement dans Paramètres."
      >
        <Textarea id="knowledge" name="knowledge" rows={9} defaultValue={settings.knowledge} maxLength={12000} placeholder={"Horaires : lundi–samedi 6h–22h, dimanche 8h–14h\nCours : CrossFit, Yoga, Boxe…\nSéance d'essai gratuite sur rendez-vous"} />
      </Field>
      <Field label="Message quand l'équipe prend le relais" htmlFor="handoff_message" error={fe.handoff_message} required>
        <Input id="handoff_message" name="handoff_message" defaultValue={settings.handoff_message} maxLength={300} />
      </Field>
      <fieldset className="grid gap-2 rounded-xl border p-4">
        <legend className="px-1 text-eyebrow">Ce que le bot peut faire</legend>
        <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" name="allow_leads" defaultChecked={settings.allow_leads} /> Enregistrer les personnes intéressées comme prospects</label>
        <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" name="allow_member_info" defaultChecked={settings.allow_member_info} /> Donner aux membres leur abonnement et leur code d&apos;entrée (WhatsApp uniquement)</label>
        <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" name="allow_booking" defaultChecked={settings.allow_booking} /> Réserver des cours pour les membres (WhatsApp uniquement)</label>
      </fieldset>
      <Field label="Pause du bot après une réponse de l'équipe (minutes)" htmlFor="human_pause_minutes" error={fe.human_pause_minutes}>
        <Input id="human_pause_minutes" name="human_pause_minutes" type="number" min={5} max={2880} defaultValue={settings.human_pause_minutes} className="w-32" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="justify-self-start">Enregistrer les réglages</SubmitButton>
    </form>
  );
}

/** Simulateur : discuter avec le bot comme un client, sans compte Meta. */
export function SimulatorComposer() {
  const { state, onSubmit, pending } = useFormAction(simulatorSend);
  const [value, setValue] = useState("");
  const [resetting, startReset] = useTransition();
  const lastState = useRef(state);
  useEffect(() => {
    if (state === lastState.current) return;
    lastState.current = state;
    if (state.ok) setValue("");
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form onSubmit={onSubmit} className="grid gap-2 border-t p-3">
      <div className="flex items-center gap-2">
        <label htmlFor="sim_phone" className="text-[11px] text-muted-foreground">Tester comme le numéro WhatsApp</label>
        <Input id="sim_phone" name="phone" placeholder="ex. 22 33 44 55 (facultatif)" className="h-8 max-w-48 text-[12px]" />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto"
          disabled={resetting}
          onClick={() => startReset(async () => void (await simulatorReset()))}
        >
          <RotateCcw aria-hidden /> Recommencer
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <label htmlFor="sim_body" className="sr-only">Message de test</label>
        <Textarea id="sim_body" name="body" rows={2} value={value} onChange={(e) => setValue(e.target.value)} placeholder="Écrivez comme un client : « Salut, c'est combien le mois ? »" className="min-h-11 resize-none" />
        <Button type="submit" size="icon" className="size-11 shrink-0" disabled={pending || !value.trim()} aria-label="Envoyer au bot">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
      {pending && <p className="text-[11px] text-muted-foreground">Le bot réfléchit…</p>}
    </form>
  );
}

/** Relier un compte Instagram, Messenger ou WhatsApp. */
export function ConnectAccountForm() {
  const { state, onSubmit, pending } = useFormAction(connectChannelAccount);
  const fe = state.fieldErrors ?? {};
  const [channel, setChannel] = useState("whatsapp");
  const idLabel = channel === "whatsapp" ? "Identifiant du numéro (Phone number ID)" : channel === "instagram" ? "Identifiant du compte Instagram professionnel" : "Identifiant de la page Facebook";
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Canal" htmlFor="channel">
          <NativeSelect id="channel" name="channel" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="messenger">Facebook Messenger</option>
          </NativeSelect>
        </Field>
        <Field label="Nom affiché" htmlFor="display_name" error={fe.display_name}>
          <Input id="display_name" name="display_name" placeholder="ex. Dopamine Fitness Tunis" />
        </Field>
      </div>
      <Field label={idLabel} htmlFor="external_id" error={fe.external_id} required>
        <Input id="external_id" name="external_id" inputMode="numeric" className="font-mono" />
      </Field>
      <Field label="Jeton d'accès (System User / Page)" htmlFor="access_token" error={fe.access_token} required hint="Stocké chiffré côté serveur, jamais réaffiché.">
        <Input id="access_token" name="access_token" type="password" autoComplete="off" className="font-mono" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pending={pending} className="justify-self-start"><Lock aria-hidden /> Relier le compte</SubmitButton>
    </form>
  );
}

export function AccountActions({ accountId, enabled }: { accountId: string; enabled: boolean }) {
  const [pending, start] = useTransition();
  const run = (action: string) =>
    start(async () => {
      if (action === "remove" && !confirm("Retirer ce compte ? Le bot ne répondra plus sur ce canal.")) return;
      const fd = new FormData();
      fd.set("account_id", accountId);
      fd.set("action", action);
      const r = await updateChannelAccount({}, fd);
      if (r.error) toast.error(r.error);
    });
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(enabled ? "disable" : "enable")}>
        {enabled ? "Suspendre" : "Réactiver"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("remove")} aria-label="Retirer le compte" className={cn("text-danger")}>
        <Trash2 aria-hidden />
      </Button>
    </div>
  );
}
