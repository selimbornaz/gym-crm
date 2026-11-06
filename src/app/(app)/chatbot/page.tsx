import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, BarChart3, Bot, CalendarCheck, CheckCircle2, Circle, Cpu, Hand, Inbox, MessagesSquare, PlugZap, Settings2, UserPlus } from "lucide-react";
import { MetricStrip } from "@/components/app/metric-strip";
import { PageHeader } from "@/components/app/page-header";
import { InitialsAvatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requirePagePermission } from "@/lib/auth/context";
import { publicEnv } from "@/lib/env";
import { formatDateTime, formatRelative, formatTime } from "@/lib/format";
import { CHANNEL_LABEL, DEFAULT_SETTINGS, type ChatChannel, type ChatConversation, type ChatMessage, type ChatbotSettings } from "@/lib/chatbot/types";
import { cn } from "@/lib/utils";
import {
  AccountActions,
  AutoRefresh,
  Composer,
  ConnectAccountForm,
  ConversationActions,
  MarkRead,
  ScrollToEnd,
  SettingsForm,
  SimulatorComposer,
} from "./chat-widgets";

export const metadata: Metadata = { title: "Chatbot" };

type Tab = "inbox" | "stats" | "settings" | "channels";

const CHANNEL_DOT: Record<ChatChannel, string> = {
  whatsapp: "bg-emerald-500",
  instagram: "bg-pink-500",
  messenger: "bg-sky-500",
  simulator: "bg-brand",
};

export default async function ChatbotPage({ searchParams }: { searchParams: Promise<{ tab?: string; c?: string }> }) {
  const sp = await searchParams;
  const ctx = await requirePagePermission("chatbot.inbox");
  const canManage = ctx.can("chatbot.manage");
  const tabs: Array<{ id: Tab; label: string; icon: typeof Inbox }> = [
    { id: "inbox", label: "Boîte de réception", icon: Inbox },
    { id: "stats", label: "Statistiques", icon: BarChart3 },
    ...(canManage
      ? [
          { id: "settings" as const, label: "Réglages et simulateur", icon: Settings2 },
          { id: "channels" as const, label: "Canaux", icon: PlugZap },
        ]
      : []),
  ];
  const tab: Tab = tabs.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "inbox";

  const { data: settingsRow } = await ctx.supabase.from("chatbot_settings").select("*").eq("organization_id", ctx.org.id).maybeSingle();
  const settings = { organization_id: ctx.org.id, ...DEFAULT_SETTINGS, ...(settingsRow ?? {}) } as ChatbotSettings;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Chatbot"
        description={
          <span className="flex flex-wrap items-center gap-2">
            Instagram, Facebook Messenger et WhatsApp, avec reprise par l&apos;équipe.
            {settings.enabled ? <Badge variant="success" dot>Bot actif</Badge> : <Badge variant="secondary" dot>Bot désactivé</Badge>}
          </span>
        }
      />

      <nav aria-label="Sections du chatbot" className="flex max-w-full gap-5 overflow-x-auto text-muted-foreground shadow-[inset_0_-1px_0_var(--border)] [scrollbar-width:none]">
        {tabs.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            href={`/chatbot?tab=${id}`}
            aria-current={tab === id ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent text-[13px] font-medium transition-all duration-300 ease-out hover:text-foreground",
              tab === id && "border-brand text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden /> {label}
          </Link>
        ))}
      </nav>

      {tab === "inbox" && <InboxTab ctxOrg={ctx.org.id} supabase={ctx.supabase} selectedId={sp.c} />}
      {tab === "stats" && <StatsTab ctxOrg={ctx.org.id} supabase={ctx.supabase} />}
      {tab === "settings" && canManage && <SettingsTab ctxOrg={ctx.org.id} userId={ctx.user.id} supabase={ctx.supabase} settings={settings} />}
      {tab === "channels" && canManage && <ChannelsTab ctxOrg={ctx.org.id} supabase={ctx.supabase} />}
    </div>
  );
}

type Db = Awaited<ReturnType<typeof requirePagePermission>>["supabase"];

// -----------------------------------------------------------------------------
// Boîte de réception
// -----------------------------------------------------------------------------
async function InboxTab({ ctxOrg, supabase, selectedId }: { ctxOrg: string; supabase: Db; selectedId?: string }) {
  const { data } = await supabase
    .from("chat_conversations")
    .select("*")
    .eq("organization_id", ctxOrg)
    .neq("channel", "simulator")
    .order("needs_human", { ascending: false })
    .order("last_message_at", { ascending: false })
    .limit(100);
  const conversations = (data ?? []) as ChatConversation[];
  const selected = conversations.find((c) => c.id === selectedId) ?? conversations[0] ?? null;

  const [{ data: msgData }, { data: staffData }] = selected
    ? await Promise.all([
        supabase.from("chat_messages").select("*").eq("organization_id", ctxOrg).eq("conversation_id", selected.id).order("created_at").limit(300),
        supabase.from("staff").select("user_id, profile:profiles(full_name)").eq("organization_id", ctxOrg),
      ])
    : [{ data: [] }, { data: [] }];
  const messages = (msgData ?? []) as ChatMessage[];
  const staffNames = new Map(
    ((staffData ?? []) as unknown as Array<{ user_id: string; profile: { full_name: string } | null }>).map((s) => [s.user_id, s.profile?.full_name ?? "Équipe"]),
  );

  if (!conversations.length) {
    return (
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><MessagesSquare className="size-6" strokeWidth={1.75} aria-hidden /></span>
        <p className="text-[15px] font-semibold">Aucune conversation pour l&apos;instant</p>
        <p className="max-w-md text-[13px] text-muted-foreground">
          Les messages Instagram, Messenger et WhatsApp apparaîtront ici dès qu&apos;un compte sera relié (onglet Canaux). En attendant, essayez le bot dans le simulateur.
        </p>
        <AutoRefresh intervalMs={10000} />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <AutoRefresh />
      <Card className="max-h-[70vh] overflow-y-auto p-1.5">
        <ul className="grid gap-0.5">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chatbot?tab=inbox&c=${c.id}`}
                className={cn(
                  "flex items-start gap-3 rounded-lg p-2.5 transition-all duration-300 ease-out hover:bg-accent/70",
                  selected?.id === c.id && "bg-accent ring-1 ring-inset ring-brand/30",
                )}
              >
                <span className="relative">
                  <InitialsAvatar name={c.contact_name ?? "?"} className="size-9 text-[11px]" />
                  <span aria-hidden className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-card", CHANNEL_DOT[c.channel])} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">{c.contact_name ?? c.contact_phone ?? "Contact"}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-subtle-foreground" suppressHydrationWarning>{formatRelative(c.last_message_at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{c.last_message_preview}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] uppercase tracking-[0.08em] text-subtle-foreground">{CHANNEL_LABEL[c.channel]}</span>
                    {c.needs_human && <Badge variant="danger" dot>Attend l&apos;équipe</Badge>}
                    {c.status === "human" && !c.needs_human && <Badge variant="info">Équipe</Badge>}
                    {c.status === "closed" && <Badge variant="secondary">Close</Badge>}
                    {c.unread_count > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 text-[10px] font-bold leading-4 text-primary-foreground">{c.unread_count}</span>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      {selected && (
        <Card className="flex max-h-[70vh] min-h-[480px] flex-col overflow-hidden">
          <MarkRead conversationId={selected.id} unread={selected.unread_count} />
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{selected.contact_name ?? selected.contact_phone ?? "Contact"}</p>
              <p className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <span className={cn("size-2 rounded-full", CHANNEL_DOT[selected.channel])} aria-hidden /> {CHANNEL_LABEL[selected.channel]}
                {selected.contact_phone && <span className="font-mono">+{selected.contact_phone.replace(/^\+/, "")}</span>}
                {selected.member_id && <Link href={`/members/${selected.member_id}`} className="text-brand hover:underline">Fiche membre</Link>}
                {selected.lead_id && <Link href="/leads" className="text-brand hover:underline">Prospect créé</Link>}
              </p>
            </div>
            <ConversationActions conversationId={selected.id} status={selected.status} />
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} staffName={m.staff_user_id ? staffNames.get(m.staff_user_id) : undefined} />
            ))}
            <ScrollToEnd trigger={messages.at(-1)?.id ?? ""} />
          </div>
          <Composer conversationId={selected.id} channelLabel={CHANNEL_LABEL[selected.channel]} />
        </Card>
      )}
    </div>
  );
}

function MessageBubble({ message, staffName }: { message: ChatMessage; staffName?: string }) {
  const fromContact = message.sender === "contact";
  const label = message.sender === "bot" ? "Bot" : message.sender === "staff" ? (staffName ?? "Équipe") : message.sender === "system" ? "Système" : null;
  return (
    <div className={cn("flex", fromContact ? "justify-start" : "justify-end")}>
      <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed", fromContact ? "rounded-bl-md bg-secondary" : message.sender === "bot" ? "rounded-br-md border border-brand/30 bg-brand/10" : "rounded-br-md bg-brand-metal text-primary-foreground")}>
        {label && (
          <p className={cn("mb-0.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em]", message.sender === "staff" ? "text-primary-foreground/70" : "text-brand")}>
            {message.sender === "bot" ? <Bot className="size-3" aria-hidden /> : <Hand className="size-3" aria-hidden />} {label}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <p className={cn("mt-1 text-right text-[10px] tabular-nums", message.sender === "staff" ? "text-primary-foreground/60" : "text-subtle-foreground")}>{formatTime(message.created_at)}</p>
        {message.delivery_error && <p className="mt-1 text-[11px] font-medium text-danger">Non délivré : {message.delivery_error}</p>}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Statistiques (30 derniers jours)
// -----------------------------------------------------------------------------
async function StatsTab({ ctxOrg, supabase }: { ctxOrg: string; supabase: Db }) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: events }, { data: inbound }] = await Promise.all([
    supabase.from("chat_events").select("kind, channel, details, created_at").eq("organization_id", ctxOrg).gte("created_at", since).limit(20000),
    supabase.from("chat_messages").select("created_at").eq("organization_id", ctxOrg).eq("sender", "contact").gte("created_at", since).limit(20000),
  ]);
  const ev = ((events ?? []) as Array<{ kind: string; channel: ChatChannel; details: Record<string, number> | null }>).filter((e) => e.channel !== "simulator");
  const count = (kind: string) => ev.filter((e) => e.kind === kind).length;
  const conversations = count("conversation_started");
  const replies = count("bot_reply");
  const handoffs = count("handoff");
  const automated = replies ? Math.round(((replies - handoffs) / replies) * 100) : null;
  const tokensIn = ev.reduce((n, e) => n + (e.kind === "bot_reply" ? Number(e.details?.input_tokens ?? 0) : 0), 0);
  const tokensOut = ev.reduce((n, e) => n + (e.kind === "bot_reply" ? Number(e.details?.output_tokens ?? 0) : 0), 0);
  // Tarif Claude Opus 5.5 : 4 $ / million de jetons en entrée, 20 $ en sortie (estimation).
  const costUsd = (tokensIn * 4 + tokensOut * 20) / 1_000_000;

  const byChannel = (["whatsapp", "instagram", "messenger"] as const).map((ch) => ({
    ch,
    conversations: ev.filter((e) => e.channel === ch && e.kind === "conversation_started").length,
    leads: ev.filter((e) => e.channel === ch && e.kind === "lead_created").length,
  }));
  const maxConv = Math.max(1, ...byChannel.map((b) => b.conversations));

  // Messages reçus par jour (Tunis), sur 30 jours.
  const perDay = new Map<string, number>();
  for (const m of (inbound ?? []) as Array<{ created_at: string }>) {
    const d = new Date(m.created_at).toLocaleDateString("fr-CA", { timeZone: "Africa/Tunis" });
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
  }
  const days = Array.from({ length: 30 }, (_, i) => new Date(Date.now() - (29 - i) * 86_400_000).toLocaleDateString("fr-CA", { timeZone: "Africa/Tunis" }));
  const maxDay = Math.max(1, ...days.map((d) => perDay.get(d) ?? 0));

  return (
    <div className="grid gap-6">
      <MetricStrip
        metrics={[
          { label: "Conversations · 30 j", icon: MessagesSquare, value: conversations, hint: `${(inbound ?? []).length} messages reçus` },
          { label: "Prospects créés", icon: UserPlus, value: count("lead_created"), tone: count("lead_created") > 0 ? "success" : undefined, hint: "Ajoutés au Kanban" },
          { label: "Cours réservés", icon: CalendarCheck, value: count("booking"), hint: `${count("member_identified")} membres reconnus` },
          { label: "Passés à l'équipe", icon: Hand, value: handoffs, tone: handoffs > 0 ? "warning" : undefined, hint: automated !== null ? `${automated} % réglés par le bot` : "—" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <p className="text-eyebrow">Messages reçus par jour</p>
          <div className="mt-4 flex h-40 items-end gap-1" role="img" aria-label="Messages reçus par jour sur 30 jours">
            {days.map((d) => {
              const v = perDay.get(d) ?? 0;
              return (
                <div key={d} className="group relative flex-1">
                  <div className="w-full rounded-t-sm bg-chart-1 transition-all duration-300 ease-out group-hover:brightness-125" style={{ height: `${Math.max((v / maxDay) * 152, v ? 4 : 1)}px`, opacity: v ? 1 : 0.15 }} />
                  <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[10px] shadow-float group-hover:block">{d.slice(8, 10)}/{d.slice(5, 7)} : {v}</span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-eyebrow">Par canal</p>
          <ul className="mt-4 grid gap-4">
            {byChannel.map((b) => (
              <li key={b.ch}>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 font-medium"><span className={cn("size-2.5 rounded-full", CHANNEL_DOT[b.ch])} aria-hidden /> {CHANNEL_LABEL[b.ch]}</span>
                  <span className="tabular-nums text-muted-foreground">{b.conversations} conv. · {b.leads} prospects</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                  <div className={cn("h-full rounded-full", CHANNEL_DOT[b.ch])} style={{ width: `${(b.conversations / maxConv) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex items-center gap-2 rounded-lg border bg-secondary/40 p-3 text-[12px] text-muted-foreground">
            <Cpu className="size-4 text-brand" aria-hidden />
            {replies} réponses du bot · coût IA estimé ≈ {costUsd.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} $
          </div>
        </Card>
      </div>
      {count("error") > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
          <AlertTriangle className="size-4" aria-hidden /> {count("error")} message(s) sans réponse du bot (IA indisponible) : transmis à l&apos;équipe.
        </p>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Réglages + simulateur
// -----------------------------------------------------------------------------
async function SettingsTab({ ctxOrg, userId, supabase, settings }: { ctxOrg: string; userId: string; supabase: Db; settings: ChatbotSettings }) {
  const { data: conv } = await supabase
    .from("chat_conversations")
    .select("id")
    .eq("organization_id", ctxOrg)
    .eq("channel", "simulator")
    .eq("external_user_id", `simulateur-${userId}`)
    .maybeSingle();
  const { data: msgData } = conv
    ? await supabase.from("chat_messages").select("*").eq("organization_id", ctxOrg).eq("conversation_id", conv.id).order("created_at").limit(200)
    : { data: [] };
  const messages = (msgData ?? []) as ChatMessage[];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="p-5">
        <SettingsForm settings={settings} />
      </Card>
      <Card className="flex h-fit max-h-[80vh] flex-col overflow-hidden xl:sticky xl:top-20">
        <div className="border-b px-4 py-3">
          <p className="flex items-center gap-2 text-[14px] font-semibold"><Bot className="size-4 text-brand" aria-hidden /> Simulateur</p>
          <p className="text-[12px] text-muted-foreground">Parlez au bot comme un client : il utilise vos vraies formules et votre planning. Rien n&apos;est envoyé à Meta.{!settings.enabled && " Activez le bot pour qu'il réponde."}</p>
        </div>
        <div className="min-h-64 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && <p className="py-10 text-center text-[13px] text-subtle-foreground">Écrivez un premier message ci-dessous.</p>}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <ScrollToEnd trigger={messages.at(-1)?.id ?? ""} />
        </div>
        <SimulatorComposer />
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Canaux : comptes reliés, état de la configuration, guide
// -----------------------------------------------------------------------------
async function ChannelsTab({ ctxOrg, supabase }: { ctxOrg: string; supabase: Db }) {
  const { data } = await supabase.from("chat_channel_accounts").select("id, channel, external_id, display_name, enabled, connected_at").eq("organization_id", ctxOrg).order("connected_at");
  const accounts = (data ?? []) as Array<{ id: string; channel: ChatChannel; external_id: string; display_name: string | null; enabled: boolean; connected_at: string }>;
  const checks = [
    { ok: Boolean(process.env.ANTHROPIC_API_KEY), label: "Clé IA Anthropic (ANTHROPIC_API_KEY)" },
    { ok: Boolean(process.env.META_APP_SECRET), label: "Secret de l'application Meta (META_APP_SECRET)" },
    { ok: Boolean(process.env.META_VERIFY_TOKEN), label: "Jeton de vérification du webhook (META_VERIFY_TOKEN)" },
    { ok: accounts.some((a) => a.enabled), label: "Au moins un compte relié" },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="grid h-fit gap-6">
        <Card className="p-5">
          <p className="text-eyebrow">Configuration</p>
          <ul className="mt-3 grid gap-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[13px]">
                {c.ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <Circle className="size-4 text-subtle-foreground" aria-hidden />}
                <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
                <span className="sr-only">{c.ok ? "configuré" : "à faire"}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-lg border bg-secondary/40 p-3 text-[12px]">
            <p className="text-muted-foreground">URL du webhook à saisir chez Meta :</p>
            <p className="mt-1 select-all break-all font-mono text-[12px]">{publicEnv.siteUrl}/api/meta/webhook</p>
          </div>
        </Card>
        <Card className="p-5">
          <p className="text-eyebrow">Comptes reliés</p>
          {accounts.length === 0 ? (
            <p className="mt-3 text-[13px] text-muted-foreground">Aucun compte pour l&apos;instant.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/70">
              {accounts.map((a) => (
                <li key={a.id} className={cn("flex items-center gap-3 py-3", !a.enabled && "opacity-60")}>
                  <span className={cn("size-2.5 rounded-full", CHANNEL_DOT[a.channel])} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{a.display_name ?? CHANNEL_LABEL[a.channel]} <span className="text-muted-foreground">· {CHANNEL_LABEL[a.channel]}</span></span>
                    <span className="block font-mono text-[11px] text-subtle-foreground">{a.external_id} · relié le {formatDateTime(a.connected_at)}</span>
                  </span>
                  {a.enabled ? <Badge variant="success" dot>Actif</Badge> : <Badge variant="secondary">Suspendu</Badge>}
                  <AccountActions accountId={a.id} enabled={a.enabled} />
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <p className="mb-4 text-eyebrow">Relier un compte</p>
          <ConnectAccountForm />
        </Card>
      </div>
      <Card className="h-fit p-5">
        <MetaGuide />
      </Card>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span className="bg-brand-metal flex size-7 items-center justify-center rounded-full text-[12px] font-bold text-primary-foreground">{n}</span>
      <div>
        <p className="text-[14px] font-semibold">{title}</p>
        <div className="mt-1 space-y-1 text-[13px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </li>
  );
}

/** Guide pas à pas : création des comptes Meta et liaison. */
function MetaGuide() {
  return (
    <div>
      <p className="text-eyebrow">Guide : relier Instagram, Facebook et WhatsApp</p>
      <ol className="mt-4 grid gap-5">
        <Step n={1} title="Compte Meta Business et page Facebook">
          <p>Sur business.facebook.com, créez un portefeuille Business pour la salle, puis une page Facebook « Dopamine Fitness » si elle n&apos;existe pas.</p>
        </Step>
        <Step n={2} title="Instagram professionnel">
          <p>Dans l&apos;application Instagram : Paramètres → Type de compte → Compte professionnel, puis reliez-le à la page Facebook (Centre de comptes).</p>
        </Step>
        <Step n={3} title="Application Meta">
          <p>Sur developers.facebook.com, créez une application de type « Entreprise » rattachée au portefeuille, et ajoutez les produits Messenger, Instagram et WhatsApp.</p>
          <p>Dans Paramètres de l&apos;app → Général, copiez la « Clé secrète » : c&apos;est META_APP_SECRET.</p>
        </Step>
        <Step n={4} title="Numéro WhatsApp Business">
          <p>Produit WhatsApp → Configuration de l&apos;API : ajoutez le numéro de la salle (il ne doit pas être utilisé dans l&apos;application WhatsApp ordinaire) et notez son « Phone number ID ».</p>
        </Step>
        <Step n={5} title="Jeton d'accès permanent">
          <p>Portefeuille Business → Utilisateurs système : créez un utilisateur système Administrateur, attribuez-lui l&apos;app, la page, le compte Instagram et le compte WhatsApp, puis générez un jeton avec les autorisations pages_messaging, instagram_manage_messages et whatsapp_business_messaging.</p>
        </Step>
        <Step n={6} title="Variables sur Vercel">
          <p>Ajoutez META_APP_SECRET, META_VERIFY_TOKEN (un mot de passe que vous inventez) et ANTHROPIC_API_KEY, puis redéployez. Ne collez jamais ces valeurs dans une conversation.</p>
        </Step>
        <Step n={7} title="Webhook">
          <p>Dans chaque produit (Messenger, Instagram, WhatsApp) → Webhooks : URL de rappel = l&apos;adresse affichée à gauche, jeton de vérification = META_VERIFY_TOKEN. Abonnez les champs « messages ».</p>
        </Step>
        <Step n={8} title="Relier les comptes ici">
          <p>Avec le formulaire « Relier un compte » : Phone number ID pour WhatsApp, identifiant de la page pour Messenger, identifiant du compte Instagram professionnel pour Instagram, et le jeton de l&apos;étape 5.</p>
        </Step>
        <Step n={9} title="Publier l'application">
          <p>Tant que l&apos;app est en mode développement, seuls ses testeurs reçoivent des réponses. Passez-la en mode « En ligne » (vérification de l&apos;entreprise par Meta) pour répondre à tous vos clients.</p>
        </Step>
      </ol>
    </div>
  );
}
