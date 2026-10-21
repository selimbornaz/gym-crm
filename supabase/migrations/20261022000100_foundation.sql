-- =============================================================================
-- 0001 · Fondations : extensions, schéma privé, organisations (tenants),
--        profils, personnel, rôles & permissions, compteurs, audit.
-- =============================================================================
-- Principes :
--  * Chaque donnée métier porte `organization_id` (isolation multi-salles).
--  * Les helpers d'autorisation vivent dans le schéma `private`, non exposé
--    par l'API PostgREST de Supabase.
--  * Montants en numeric(12,3) : le dinar tunisien a 3 décimales (millimes).
-- =============================================================================

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Types énumérés
-- -----------------------------------------------------------------------------
create type public.staff_role as enum ('owner', 'receptionist', 'coach');

-- -----------------------------------------------------------------------------
-- Organisations (une salle = un tenant)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) between 2 and 120),
  slug          text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  legal_name    text,
  tax_id        text,                       -- matricule fiscal
  address       text,
  phone         text,
  email         text,
  logo_path     text,
  currency      char(3) not null default 'TND',
  timezone      text not null default 'Africa/Tunis',
  locale        text not null default 'fr' check (locale in ('fr', 'ar')),
  receipt_footer text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Paramètres de fonctionnement propres à chaque salle.
create table public.organization_settings (
  organization_id          uuid primary key references public.organizations (id) on delete cascade,
  expiry_alert_days        int  not null default 7  check (expiry_alert_days between 1 and 60),
  checkin_debounce_minutes int  not null default 5  check (checkin_debounce_minutes between 0 and 240),
  receipt_prefix           text not null default 'R' check (receipt_prefix ~ '^[A-Z0-9-]{1,8}$'),
  member_code_prefix       text not null default 'M' check (member_code_prefix ~ '^[A-Z0-9-]{1,8}$'),
  -- Canaux externes : désactivés tant qu'aucun fournisseur n'est configuré.
  notify_email             boolean not null default false,
  notify_sms               boolean not null default false,
  notify_whatsapp          boolean not null default false,
  notify_types             text[] not null default array[
    'membership_expiring', 'membership_expired', 'unpaid_balance',
    'upcoming_session', 'new_member', 'announcement', 'equipment_maintenance'
  ],
  updated_at               timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Profils (1-1 avec auth.users) et personnel (lien utilisateur <-> salle)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  avatar_path text,
  created_at  timestamptz not null default now()
);

create table public.staff (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Référence le profil (lui-même lié 1-1 à auth.users) : permet la jointure API staff -> profiles.
  user_id         uuid not null references public.profiles (id) on delete cascade,
  role            public.staff_role not null,
  is_active       boolean not null default true,
  job_title       text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);
create index staff_user_idx on public.staff (user_id) where is_active;

-- Administrateurs de la plateforme SaaS. N'accorde AUCUN accès aux données
-- des salles : les politiques RLS ne consultent jamais cette table.
create table private.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Matrice rôle -> permissions (source de vérité côté base)
-- -----------------------------------------------------------------------------
create table private.role_permissions (
  role       public.staff_role not null,
  permission text not null,
  primary key (role, permission)
);

insert into private.role_permissions (role, permission)
select 'owner'::public.staff_role, p from unnest(array[
  'dashboard.view', 'dashboard.financial',
  'members.read_all', 'members.write', 'members.archive', 'members.export', 'member_notes.manage',
  'leads.manage',
  'plans.read', 'plans.manage',
  'subscriptions.read', 'subscriptions.write', 'subscriptions.manage',
  'payments.read', 'payments.create', 'payments.refund', 'payment_methods.manage',
  'expenses.manage', 'reports.financial',
  'attendance.read', 'attendance.write', 'attendance.correct', 'attendance.override',
  'coaches.read', 'coaches.manage',
  'workouts.manage_all', 'progress.manage_all',
  'schedule.read', 'schedule.manage', 'bookings.manage',
  'notifications.read', 'announcements.manage',
  'equipment.read', 'equipment.manage',
  'staff.manage', 'settings.manage', 'audit.read'
]) p
union all
select 'receptionist', p from unnest(array[
  'dashboard.view',
  'members.read_all', 'members.write', 'members.archive', 'member_notes.manage',
  'leads.manage',
  'plans.read',
  'subscriptions.read', 'subscriptions.write',
  'payments.read', 'payments.create',
  'attendance.read', 'attendance.write',
  'coaches.read',
  'schedule.read', 'schedule.manage', 'bookings.manage',
  'notifications.read',
  'equipment.read', 'equipment.manage'
]) p
union all
select 'coach', p from unnest(array[
  'dashboard.view',
  'members.read_assigned',
  'coaches.read',
  'workouts.manage_assigned', 'progress.manage_assigned',
  'attendance.read_assigned',
  'schedule.read', 'schedule.manage_own',
  'notifications.read',
  'equipment.read'
]) p;

-- -----------------------------------------------------------------------------
-- Helpers d'autorisation (SECURITY DEFINER, search_path verrouillé)
-- -----------------------------------------------------------------------------

/** L'utilisateur courant est-il membre actif du personnel de cette salle ? */
create function private.is_staff_of(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.organization_id = org and s.user_id = auth.uid() and s.is_active
  );
$$;

/** L'utilisateur courant possède-t-il `perm` dans cette salle ? */
create function private.has_permission(org uuid, perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.staff s
    join private.role_permissions rp on rp.role = s.role
    where s.organization_id = org
      and s.user_id = auth.uid()
      and s.is_active
      and rp.permission = perm
  );
$$;

/** Lève une erreur explicite si la permission manque (utilisé par les RPC). */
create function private.require_permission(org uuid, perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentification requise' using errcode = '28000';
  end if;
  if not private.has_permission(org, perm) then
    raise exception 'Action non autorisée' using errcode = '42501', hint = perm;
  end if;
end;
$$;

/** Date du jour dans le fuseau horaire de la salle (Africa/Tunis par défaut). */
create function private.org_today(org uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(
    (select o.timezone from public.organizations o where o.id = org), 'Africa/Tunis'))::date;
$$;

grant execute on function private.is_staff_of(uuid), private.has_permission(uuid, text),
  private.require_permission(uuid, text), private.org_today(uuid) to authenticated;

/** Permissions de l'utilisateur courant dans une salle (consommé par l'UI). */
create function public.my_permissions(org uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from public.staff s
  join private.role_permissions rp on rp.role = s.role
  where s.organization_id = org and s.user_id = auth.uid() and s.is_active;
$$;
grant execute on function public.my_permissions(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Compteurs par salle (numéros de membre, reçus) — sûrs en concurrence
-- -----------------------------------------------------------------------------
create table private.counters (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  key             text not null,
  value           bigint not null default 0,
  primary key (organization_id, key)
);

/** Incrémente atomiquement (verrou de ligne via UPSERT) et renvoie la nouvelle valeur. */
create function private.next_counter(org uuid, counter_key text) returns bigint
language sql volatile security definer set search_path = '' as $$
  insert into private.counters as c (organization_id, key, value)
  values (org, counter_key, 1)
  on conflict (organization_id, key) do update set value = c.value + 1
  returning c.value;
$$;

-- -----------------------------------------------------------------------------
-- Journal d'audit
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id   uuid references auth.users (id) on delete set null,
  action          text not null,              -- ex. 'payments.insert', 'subscription.extend'
  entity_type     text not null,
  entity_id       text,
  reason          text,
  before_data     jsonb,
  after_data      jsonb,
  created_at      timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (organization_id, entity_type, entity_id);

/** Écrit une entrée d'audit ; le motif peut venir de `app.audit_reason` (posé par les RPC). */
create function private.write_audit(
  org uuid, p_action text, p_entity_type text, p_entity_id text,
  p_before jsonb default null, p_after jsonb default null, p_reason text default null
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, reason, before_data, after_data)
  values (org, auth.uid(), p_action, p_entity_type, p_entity_id,
          coalesce(p_reason, nullif(current_setting('app.audit_reason', true), '')),
          p_before, p_after);
$$;

/** Trigger générique : journalise INSERT/UPDATE/DELETE des tables sensibles. */
create function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  perform private.write_audit(
    (rec ->> 'organization_id')::uuid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    rec ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

/** Met à jour `updated_at` automatiquement. */
create function private.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
  for each row execute function private.touch_updated_at();
create trigger organization_settings_touch before update on public.organization_settings
  for each row execute function private.touch_updated_at();
create trigger staff_touch before update on public.staff
  for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Garde-fous sur le personnel : pas d'auto-promotion, toujours un propriétaire
-- -----------------------------------------------------------------------------
create function private.guard_staff_changes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  remaining_owners int;
begin
  -- Un utilisateur ne peut jamais modifier son propre rôle ni se (dés)activer.
  -- (auth.uid() est NULL pour le service_role, utilisé par le bootstrap.)
  if tg_op = 'UPDATE' and auth.uid() is not null and old.user_id = auth.uid()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Vous ne pouvez pas modifier votre propre rôle ou statut' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (new.organization_id <> old.organization_id or new.user_id <> old.user_id) then
    raise exception 'Changement de salle ou d''utilisateur interdit' using errcode = '42501';
  end if;

  -- Il doit toujours rester au moins un propriétaire actif.
  if (tg_op = 'DELETE' and old.role = 'owner' and old.is_active)
     or (tg_op = 'UPDATE' and old.role = 'owner' and old.is_active
         and (new.role <> 'owner' or not new.is_active)) then
    select count(*) into remaining_owners
    from public.staff
    where organization_id = old.organization_id and role = 'owner' and is_active and id <> old.id;
    if remaining_owners = 0 then
      raise exception 'La salle doit conserver au moins un propriétaire actif' using errcode = '23514';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger staff_guard before update or delete on public.staff
  for each row execute function private.guard_staff_changes();
create trigger staff_audit after insert or update or delete on public.staff
  for each row execute function private.audit_trigger();
create trigger organizations_audit after update on public.organizations
  for each row execute function private.audit_trigger();

-- Paramètres créés automatiquement avec l'organisation.
create function private.init_organization() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.organization_settings (organization_id) values (new.id);
  insert into public.payment_methods (organization_id, name, code) values
    (new.id, 'Espèces', 'cash'),
    (new.id, 'Virement bancaire', 'transfer'),
    (new.id, 'Carte (TPE)', 'card'),
    (new.id, 'Chèque', 'cheque');
  return new;
end;
$$;

-- Profil créé à l'inscription d'un utilisateur Auth.
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)), lower(new.email))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

create trigger on_auth_user_created after insert or update of email on auth.users
  for each row execute function private.handle_new_user();

-- Profils créés pour d'éventuels utilisateurs existant avant cette migration.
insert into public.profiles (id, full_name, email)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1)), lower(u.email)
from auth.users u
on conflict (id) do nothing;
