-- =============================================================================
-- Chatbot Instagram / Facebook Messenger / WhatsApp
-- -----------------------------------------------------------------------------
-- Les messages des clients arrivent par le webhook Meta (serveur, clé service),
-- l'IA répond, le personnel peut reprendre la main depuis la boîte de réception.
-- Sécurité :
--   * les jetons Meta vivent dans le schéma private (jamais lisibles par l'API) ;
--   * le bot n'agit que via des fonctions réservées au service_role, qui
--     reçoivent l'identité du contact du serveur (jamais du modèle d'IA) ;
--   * le personnel lit/écrit selon chatbot.inbox / chatbot.manage (RLS).
-- =============================================================================

create type public.chat_channel as enum ('whatsapp', 'instagram', 'messenger', 'simulator');
create type public.chat_status as enum ('bot', 'human', 'closed');
create type public.chat_sender as enum ('contact', 'bot', 'staff', 'system');

-- Permissions : boîte de réception (propriétaire + accueil), réglages (propriétaire).
insert into private.role_permissions (role, permission) values
  ('owner', 'chatbot.inbox'), ('owner', 'chatbot.manage'),
  ('receptionist', 'chatbot.inbox')
on conflict do nothing;

-- Le prospect garde son canal d'origine.
alter type public.lead_source add value if not exists 'chatbot';
-- Clé composite (salle, id) pour rattacher une conversation à un prospect de SA salle.
alter table public.leads add constraint leads_org_id_key unique (organization_id, id);

-- -----------------------------------------------------------------------------
-- Réglages du bot (une ligne par salle)
-- -----------------------------------------------------------------------------
create table public.chatbot_settings (
  organization_id     uuid primary key references public.organizations (id) on delete cascade,
  enabled             boolean not null default false,
  bot_name            text not null default 'Assistant Dopamine Fitness' check (length(trim(bot_name)) between 2 and 60),
  tone                text not null default 'chaleureux, motivant et professionnel' check (length(tone) <= 200),
  welcome_message     text check (length(welcome_message) <= 600),
  knowledge           text not null default '' check (length(knowledge) <= 12000),
  handoff_message     text not null default 'Un membre de l''équipe va vous répondre très vite.' check (length(handoff_message) <= 300),
  allow_member_info   boolean not null default true,
  allow_booking       boolean not null default true,
  allow_leads         boolean not null default true,
  human_pause_minutes int not null default 120 check (human_pause_minutes between 5 and 2880),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null default auth.uid()
);
create trigger chatbot_settings_touch before update on public.chatbot_settings
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Comptes connectés (identifiants publics) et jetons (privés)
-- -----------------------------------------------------------------------------
create table public.chat_channel_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel         public.chat_channel not null check (channel <> 'simulator'),
  external_id     text not null check (external_id ~ '^[0-9]{5,30}$'),   -- phone_number_id / page id / compte IG
  display_name    text check (length(display_name) <= 120),
  enabled         boolean not null default true,
  connected_at    timestamptz not null default now(),
  connected_by    uuid references auth.users (id) on delete set null default auth.uid(),
  unique (channel, external_id),
  unique (organization_id, id)
);

create table private.chat_channel_secrets (
  account_id   uuid primary key references public.chat_channel_accounts (id) on delete cascade,
  access_token text not null check (length(access_token) between 20 and 2000),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Conversations, messages, événements (statistiques)
-- -----------------------------------------------------------------------------
create table public.chat_conversations (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.organizations (id) on delete cascade,
  channel              public.chat_channel not null,
  account_id           uuid,
  external_user_id     text not null check (length(external_user_id) between 1 and 120),
  contact_name         text check (length(contact_name) <= 120),
  contact_phone        text check (length(contact_phone) <= 30),
  member_id            uuid,
  lead_id              uuid,
  status               public.chat_status not null default 'bot',
  needs_human          boolean not null default false,
  bot_paused_until     timestamptz,
  unread_count         int not null default 0 check (unread_count >= 0),
  last_message_at      timestamptz not null default now(),
  last_message_preview text,
  last_inbound_at      timestamptz,
  created_at           timestamptz not null default now(),
  unique (organization_id, channel, external_user_id),
  unique (organization_id, id),
  foreign key (organization_id, account_id) references public.chat_channel_accounts (organization_id, id) on delete set null (account_id),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete set null (member_id),
  foreign key (organization_id, lead_id) references public.leads (organization_id, id) on delete set null (lead_id)
);
create index chat_conversations_inbox_idx on public.chat_conversations (organization_id, last_message_at desc);
create index chat_conversations_attention_idx on public.chat_conversations (organization_id) where needs_human or unread_count > 0;

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null,
  sender          public.chat_sender not null,
  body            text not null check (length(body) between 1 and 4096),
  staff_user_id   uuid references auth.users (id) on delete set null,
  external_id     text,                                  -- id du message chez Meta (anti-doublon)
  delivery_error  text,
  input_tokens    int,
  output_tokens   int,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.chat_conversations (organization_id, id) on delete cascade
);
create unique index chat_messages_external_key on public.chat_messages (organization_id, external_id) where external_id is not null;
create index chat_messages_conversation_idx on public.chat_messages (organization_id, conversation_id, created_at);

create table public.chat_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid,
  channel         public.chat_channel not null,
  kind            text not null check (kind in ('conversation_started', 'bot_reply', 'lead_created', 'member_identified', 'booking', 'handoff', 'staff_reply', 'error')),
  details         jsonb,
  created_at      timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.chat_conversations (organization_id, id) on delete set null (conversation_id)
);
create index chat_events_org_idx on public.chat_events (organization_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.chatbot_settings enable row level security;
alter table public.chat_channel_accounts enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_events enable row level security;

create policy chatbot_settings_read on public.chatbot_settings for select to authenticated
  using (private.has_permission(organization_id, 'chatbot.inbox'));
create policy chatbot_settings_write on public.chatbot_settings for insert to authenticated
  with check (private.has_permission(organization_id, 'chatbot.manage'));
create policy chatbot_settings_update on public.chatbot_settings for update to authenticated
  using (private.has_permission(organization_id, 'chatbot.manage'))
  with check (private.has_permission(organization_id, 'chatbot.manage'));

create policy chat_accounts_read on public.chat_channel_accounts for select to authenticated
  using (private.has_permission(organization_id, 'chatbot.manage'));
create policy chat_accounts_update on public.chat_channel_accounts for update to authenticated
  using (private.has_permission(organization_id, 'chatbot.manage'))
  with check (private.has_permission(organization_id, 'chatbot.manage'));
create policy chat_accounts_delete on public.chat_channel_accounts for delete to authenticated
  using (private.has_permission(organization_id, 'chatbot.manage'));

create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (private.has_permission(organization_id, 'chatbot.inbox'));
create policy chat_conversations_update on public.chat_conversations for update to authenticated
  using (private.has_permission(organization_id, 'chatbot.inbox'))
  with check (private.has_permission(organization_id, 'chatbot.inbox'));

create policy chat_messages_read on public.chat_messages for select to authenticated
  using (private.has_permission(organization_id, 'chatbot.inbox'));
-- Le personnel n'écrit qu'en son nom ; le reste passe par le serveur (service_role).
create policy chat_messages_staff_insert on public.chat_messages for insert to authenticated
  with check (private.has_permission(organization_id, 'chatbot.inbox') and sender = 'staff' and staff_user_id = auth.uid());

create policy chat_events_read on public.chat_events for select to authenticated
  using (private.has_permission(organization_id, 'chatbot.inbox'));

-- Le statut de conversation : pas de modification des colonnes d'identité par le personnel.
create function private.chat_conversations_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.organization_id <> old.organization_id or new.channel <> old.channel
     or new.external_user_id <> old.external_user_id or new.account_id is distinct from old.account_id then
    raise exception 'Conversation : identité non modifiable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger chat_conversations_guard before update on public.chat_conversations
  for each row execute function private.chat_conversations_guard();

-- -----------------------------------------------------------------------------
-- Connexion d'un compte Meta (propriétaire) : le jeton part directement en privé.
-- -----------------------------------------------------------------------------
create function public.chatbot_connect_account(
  p_org uuid, p_channel public.chat_channel, p_external_id text, p_display_name text, p_access_token text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform private.require_permission(p_org, 'chatbot.manage');
  if p_channel = 'simulator' then raise exception 'Canal invalide' using errcode = '22023'; end if;
  insert into public.chat_channel_accounts (organization_id, channel, external_id, display_name)
  values (p_org, p_channel, trim(p_external_id), nullif(trim(p_display_name), ''))
  on conflict (channel, external_id) do update
    set display_name = excluded.display_name, enabled = true, connected_at = now(), connected_by = auth.uid()
    where public.chat_channel_accounts.organization_id = p_org
  returning id into v_id;
  if v_id is null then raise exception 'Ce compte est déjà relié à une autre salle' using errcode = '42501'; end if;
  insert into private.chat_channel_secrets (account_id, access_token) values (v_id, trim(p_access_token))
  on conflict (account_id) do update set access_token = excluded.access_token, updated_at = now();
  perform private.write_audit(p_org, 'chatbot.account_connected', 'chat_channel_account', v_id::text, null,
    jsonb_build_object('channel', p_channel, 'external_id', p_external_id), null);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Fonctions du bot : service_role uniquement (webhook / simulateur côté serveur)
-- -----------------------------------------------------------------------------

/** Jeton d'envoi d'un compte connecté. */
create function public.chatbot_account_token(p_account uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.access_token from private.chat_channel_secrets s
  join public.chat_channel_accounts a on a.id = s.account_id
  where s.account_id = p_account and a.enabled;
$$;

/**
 * Réservation par le bot : mêmes règles que book_session (séance programmée, à
 * venir, places libres, membre non archivé) + abonnement valide à la date du cours.
 */
create function public.chatbot_book_session(p_org uuid, p_session uuid, p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_member public.members;
  v_booked int;
  v_id uuid;
begin
  select * into v_session from public.sessions s where s.organization_id = p_org and s.id = p_session for update;
  if not found then raise exception 'Séance introuvable' using errcode = 'P0002'; end if;
  select * into v_member from public.members m where m.organization_id = p_org and m.id = p_member;
  if not found then raise exception 'Membre introuvable' using errcode = 'P0002'; end if;

  if v_session.status <> 'scheduled' then raise exception 'Séance annulée ou terminée' using errcode = '22023'; end if;
  if v_session.starts_at <= now() then raise exception 'La séance a déjà commencé' using errcode = '22023'; end if;
  if v_member.archived_at is not null then raise exception 'Membre archivé' using errcode = '22023'; end if;
  if v_member.membership_suspended
     or v_member.membership_end_date is null
     or v_member.membership_end_date < (v_session.starts_at at time zone 'Africa/Tunis')::date then
    raise exception 'Abonnement non valide à la date de la séance' using errcode = '22023';
  end if;
  if exists (select 1 from public.bookings b where b.session_id = p_session and b.member_id = p_member and b.status = 'booked') then
    raise exception 'Déjà inscrit à cette séance' using errcode = '23505';
  end if;
  select count(*) into v_booked from public.bookings b where b.session_id = p_session and b.status = 'booked';
  if v_booked >= v_session.capacity then raise exception 'Séance complète' using errcode = '23514'; end if;

  insert into public.bookings (organization_id, session_id, member_id, status, created_by)
  values (p_org, p_session, p_member, 'booked', null)
  on conflict (session_id, member_id) do update set status = 'booked', cancelled_at = null
  returning id into v_id;
  return v_id;
end;
$$;

/** Notifie le personnel (boîte de réception) qu'une conversation attend un humain. */
create function public.chatbot_notify_staff(p_org uuid, p_conversation uuid, p_title text, p_body text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_count int;
begin
  insert into public.notifications (organization_id, recipient_user_id, type, title, body, link, dedupe_key)
  select p_org, st.user_id, 'chatbot', p_title, p_body, '/chatbot?c=' || p_conversation,
         'chat:' || p_conversation || ':' || to_char(now(), 'YYYYMMDDHH24MI')
  from public.staff st
  where st.organization_id = p_org and st.is_active
    and exists (select 1 from private.role_permissions rp where rp.role = st.role and rp.permission = 'chatbot.inbox')
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  public.chatbot_account_token(uuid),
  public.chatbot_book_session(uuid, uuid, uuid),
  public.chatbot_notify_staff(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.chatbot_account_token(uuid),
  public.chatbot_book_session(uuid, uuid, uuid),
  public.chatbot_notify_staff(uuid, uuid, text, text)
to service_role;

revoke execute on function public.chatbot_connect_account(uuid, public.chat_channel, text, text, text) from public, anon;
grant execute on function public.chatbot_connect_account(uuid, public.chat_channel, text, text, text) to authenticated;
revoke execute on function private.chat_conversations_guard() from public, anon;
