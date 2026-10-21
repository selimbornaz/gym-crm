-- =============================================================================
-- 0002 · Coachs, membres, prospects, formules, abonnements, paiements,
--        remboursements et dépenses.
-- =============================================================================
-- Intégrité multi-salles : les clés étrangères incluent `organization_id`
-- (FK composites) => impossible de rattacher un abonnement d'une salle A à un
-- membre d'une salle B, même avec un identifiant deviné.
-- =============================================================================

create type public.gender as enum ('female', 'male', 'unspecified');
create type public.plan_kind as enum ('membership', 'pass', 'pt_package');
create type public.duration_unit as enum ('day', 'week', 'month', 'year');
create type public.subscription_status as enum ('active', 'suspended', 'cancelled');
create type public.subscription_event_type as enum ('created', 'renewed', 'extended', 'suspended', 'resumed', 'cancelled');
create type public.adjustment_type as enum ('refund', 'reversal');
create type public.expense_category as enum (
  'rent', 'electricity', 'water', 'equipment', 'salaries', 'maintenance', 'marketing', 'supplies', 'taxes', 'other'
);
create type public.lead_status as enum ('to_contact', 'trial_scheduled', 'trial_done', 'won', 'lost');
create type public.fitness_goal as enum ('weight_loss', 'muscle_gain', 'endurance', 'wellness', 'other');
create type public.lead_source as enum ('walk_in', 'website', 'social_media', 'referral', 'other');

-- -----------------------------------------------------------------------------
-- Coachs
-- -----------------------------------------------------------------------------
create table public.coaches (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  staff_id        uuid,                                   -- compte utilisateur lié (optionnel)
  full_name       text not null check (length(trim(full_name)) between 2 and 120),
  phone           text,
  email           text,
  specialties     text[] not null default '{}',
  bio             text,
  -- Disponibilités hebdomadaires : [{"day":1,"start":"08:00","end":"12:00"}, ...] (1 = lundi)
  availability    jsonb not null default '[]'::jsonb check (jsonb_typeof(availability) = 'array'),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, staff_id),
  foreign key (organization_id, staff_id) references public.staff (organization_id, id) on delete set null (staff_id)
);

/** Identifiant coach de l'utilisateur courant dans la salle (NULL s'il n'est pas coach). */
create function private.my_coach_id(org uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id
  from public.coaches c
  join public.staff s on s.id = c.staff_id and s.organization_id = c.organization_id
  where c.organization_id = org and s.user_id = auth.uid() and s.is_active and c.is_active
  limit 1;
$$;
grant execute on function private.my_coach_id(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Membres
-- -----------------------------------------------------------------------------
create table public.members (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations (id) on delete cascade,
  member_code             text not null,                 -- ex. M-000123 (attribué par trigger)
  first_name              text not null check (length(trim(first_name)) between 1 and 80),
  last_name               text not null check (length(trim(last_name)) between 1 and 80),
  photo_path              text,
  phone                   text,
  phone_digits            text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  email                   text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  birth_date              date check (birth_date is null or birth_date > date '1900-01-01'),
  gender                  public.gender,
  address                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  registered_on           date not null,
  coach_id                uuid,
  archived_at             timestamptz,
  archive_reason          text,
  -- Instantané de l'adhésion (maintenu par trigger, lisible par les coachs
  -- sans exposer les montants des abonnements).
  membership_end_date     date,
  membership_suspended    boolean not null default false,
  created_by              uuid references auth.users (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, member_code),
  foreign key (organization_id, coach_id) references public.coaches (organization_id, id) on delete set null (coach_id)
);
create index members_org_name_trgm on public.members
  using gin ((lower(first_name || ' ' || last_name)) extensions.gin_trgm_ops);
create index members_org_phone_idx on public.members (organization_id, phone_digits);
create index members_org_email_idx on public.members (organization_id, lower(email));
create index members_org_coach_idx on public.members (organization_id, coach_id);
create index members_org_end_idx on public.members (organization_id, membership_end_date) where archived_at is null;

/** Attribue le code membre et la date d'inscription (fuseau de la salle). */
create function private.members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
begin
  select s.member_code_prefix into prefix from public.organization_settings s where s.organization_id = new.organization_id;
  new.member_code := coalesce(prefix, 'M') || '-' || lpad(private.next_counter(new.organization_id, 'member')::text, 6, '0');
  new.registered_on := coalesce(new.registered_on, private.org_today(new.organization_id));
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;
create trigger members_before_insert before insert on public.members
  for each row execute function private.members_before_insert();

/** Le code membre et la salle sont immuables. */
create function private.members_guard() returns trigger
language plpgsql as $$
begin
  if new.member_code <> old.member_code or new.organization_id <> old.organization_id then
    raise exception 'Le code membre et la salle ne peuvent pas être modifiés' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger members_guard before update on public.members
  for each row execute function private.members_guard();
-- Modifications de fiche (archivage, coach, coordonnées) tracées.
create trigger members_audit after update on public.members
  for each row
  when (old.archived_at is distinct from new.archived_at or old.coach_id is distinct from new.coach_id
        or old.first_name is distinct from new.first_name or old.last_name is distinct from new.last_name
        or old.phone is distinct from new.phone or old.email is distinct from new.email)
  execute function private.audit_trigger();

-- Notes internes (accès restreint : propriétaire + accueil, jamais les coachs).
create table public.member_notes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid not null,
  body            text not null check (length(trim(body)) between 1 and 4000),
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade
);
create index member_notes_member_idx on public.member_notes (organization_id, member_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Prospects (tunnel de vente, conservé de la v1)
-- -----------------------------------------------------------------------------
create table public.leads (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  first_name          text not null check (length(trim(first_name)) between 1 and 80),
  last_name           text not null check (length(trim(last_name)) between 1 and 80),
  phone               text not null,
  email               text,
  goal                public.fitness_goal not null default 'other',
  source              public.lead_source not null default 'walk_in',
  status              public.lead_status not null default 'to_contact',
  notes               text,
  trial_at            timestamptz,
  coach_id            uuid,
  lost_reason         text,
  converted_member_id uuid,
  last_activity_at    timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (organization_id, coach_id) references public.coaches (organization_id, id) on delete set null (coach_id),
  foreign key (organization_id, converted_member_id) references public.members (organization_id, id) on delete set null (converted_member_id)
);
create index leads_org_status_idx on public.leads (organization_id, status, last_activity_at desc);
create trigger leads_touch before update on public.leads for each row execute function private.touch_updated_at();
create trigger coaches_touch before update on public.coaches for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Formules d'abonnement
-- -----------------------------------------------------------------------------
create table public.membership_plans (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (length(trim(name)) between 2 and 80),
  kind                public.plan_kind not null default 'membership',
  duration_value      int not null check (duration_value between 1 and 1000),
  duration_unit       public.duration_unit not null,
  sessions_included   int check (sessions_included is null or sessions_included > 0),
  price               numeric(12, 3) not null check (price >= 0),
  description         text,
  access_restrictions text,                               -- ex. « Accès 6h–16h uniquement »
  is_active           boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name),
  check (kind <> 'pt_package' or sessions_included is not null)
);
create trigger plans_touch before update on public.membership_plans for each row execute function private.touch_updated_at();
create trigger plans_audit after insert or update on public.membership_plans for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Abonnements
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  member_id         uuid not null,
  plan_id           uuid not null,
  plan_name         text not null,                        -- instantané : l'historique survit aux renommages
  kind              public.plan_kind not null,
  start_date        date not null,
  end_date          date not null,
  price             numeric(12, 3) not null check (price >= 0),
  discount          numeric(12, 3) not null default 0 check (discount >= 0),
  total_due         numeric(12, 3) generated always as (price - discount) stored,
  amount_paid       numeric(12, 3) not null default 0,    -- maintenu par trigger (paiements - remboursements)
  sessions_included int,
  sessions_used     int not null default 0 check (sessions_used >= 0),
  status            public.subscription_status not null default 'active',
  suspended_on      date,
  cancelled_at      timestamptz,
  cancel_reason     text,
  notes             text,
  request_id        uuid not null,                        -- clé d'idempotence (double-clic, retry réseau)
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, request_id),
  check (end_date >= start_date),
  check (discount <= price),
  check (status <> 'suspended' or suspended_on is not null),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete restrict,
  foreign key (organization_id, plan_id) references public.membership_plans (organization_id, id) on delete restrict,
  -- Interdit deux adhésions qui se chevauchent pour un même membre (renouvellement en double).
  constraint subscriptions_no_overlap exclude using gist (
    organization_id with =, member_id with =, daterange(start_date, end_date, '[]') with &&
  ) where (status <> 'cancelled' and kind = 'membership')
);
create index subscriptions_member_idx on public.subscriptions (organization_id, member_id, end_date desc);
create index subscriptions_end_idx on public.subscriptions (organization_id, end_date) where status <> 'cancelled';
create trigger subscriptions_touch before update on public.subscriptions for each row execute function private.touch_updated_at();
create trigger subscriptions_audit after insert or update on public.subscriptions for each row execute function private.audit_trigger();

create table public.subscription_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid not null,
  event_type      public.subscription_event_type not null,
  days            int,
  reason          text,
  actor_user_id   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, subscription_id) references public.subscriptions (organization_id, id) on delete cascade
);
create index subscription_events_sub_idx on public.subscription_events (organization_id, subscription_id, created_at);

/** Recalcule l'instantané d'adhésion du membre (fin de validité, suspension). */
create function private.refresh_member_membership(org uuid, p_member uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.members m set
    membership_end_date = (
      select max(s.end_date) from public.subscriptions s
      where s.organization_id = org and s.member_id = p_member
        and s.status <> 'cancelled' and s.kind in ('membership', 'pass')
    ),
    membership_suspended = exists (
      select 1 from public.subscriptions s
      where s.organization_id = org and s.member_id = p_member and s.status = 'suspended'
    )
  where m.organization_id = org and m.id = p_member;
$$;

create function private.subscriptions_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_member_membership(new.organization_id, new.member_id);
  return new;
end;
$$;
create trigger subscriptions_member_snapshot after insert or update of status, start_date, end_date on public.subscriptions
  for each row execute function private.subscriptions_after_change();

-- -----------------------------------------------------------------------------
-- Moyens de paiement, paiements, remboursements
-- -----------------------------------------------------------------------------
create table public.payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (length(trim(name)) between 2 and 60),
  code            text not null default 'other',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, name)
);

create trigger organizations_init after insert on public.organizations
  for each row execute function private.init_organization();

create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid not null,
  subscription_id uuid,
  method_id       uuid not null,
  amount          numeric(12, 3) not null check (amount > 0),
  refunded_amount numeric(12, 3) not null default 0 check (refunded_amount >= 0),
  paid_at         timestamptz not null default now(),
  receipt_number  text not null,
  reference       text,                                   -- n° de virement, de chèque...
  notes           text,
  recorded_by     uuid references auth.users (id) on delete set null,
  request_id      uuid not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, receipt_number),
  unique (organization_id, request_id),
  check (refunded_amount <= amount),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete restrict,
  foreign key (organization_id, subscription_id) references public.subscriptions (organization_id, id) on delete restrict,
  foreign key (organization_id, method_id) references public.payment_methods (organization_id, id) on delete restrict
);
create index payments_org_paid_idx on public.payments (organization_id, paid_at desc);
create index payments_member_idx on public.payments (organization_id, member_id, paid_at desc);
create index payments_sub_idx on public.payments (organization_id, subscription_id);
create trigger payments_audit after insert on public.payments for each row execute function private.audit_trigger();

create table public.payment_adjustments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_id      uuid not null,
  type            public.adjustment_type not null,
  amount          numeric(12, 3) not null check (amount > 0),
  reason          text not null check (length(trim(reason)) >= 3),
  method_id       uuid,
  approved_by     uuid references auth.users (id) on delete set null default auth.uid(),
  request_id      uuid not null,
  created_at      timestamptz not null default now(),
  unique (organization_id, request_id),
  foreign key (organization_id, payment_id) references public.payments (organization_id, id) on delete restrict,
  foreign key (organization_id, method_id) references public.payment_methods (organization_id, id) on delete restrict
);
create index adjustments_org_created_idx on public.payment_adjustments (organization_id, created_at desc);
create trigger adjustments_audit after insert on public.payment_adjustments for each row execute function private.audit_trigger();

/**
 * Règle comptable : un paiement validé n'est jamais supprimé ni modifié.
 * Seul `refunded_amount` évolue, et uniquement via la fonction de remboursement
 * (drapeau de transaction `app.internal`).
 */
create function private.payments_immutable() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un paiement ne peut pas être supprimé : utilisez un remboursement ou une annulation' using errcode = '42501';
  end if;
  if current_setting('app.internal', true) is distinct from 'on'
     or (to_jsonb(new) - 'refunded_amount') <> (to_jsonb(old) - 'refunded_amount') then
    raise exception 'Un paiement validé ne peut pas être modifié' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.payments_immutable();

create function private.adjustments_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Un remboursement enregistré ne peut être ni modifié ni supprimé' using errcode = '42501';
end;
$$;
create trigger adjustments_immutable before update or delete on public.payment_adjustments
  for each row execute function private.adjustments_immutable();

/** Recalcule le montant encaissé net d'un abonnement. */
create function private.refresh_subscription_paid(org uuid, p_sub uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.subscriptions s
  set amount_paid = coalesce((
    select sum(p.amount - p.refunded_amount) from public.payments p
    where p.organization_id = org and p.subscription_id = p_sub
  ), 0)
  where s.organization_id = org and s.id = p_sub;
$$;

-- -----------------------------------------------------------------------------
-- Dépenses
-- -----------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  category          public.expense_category not null,
  amount            numeric(12, 3) not null check (amount > 0),
  spent_on          date not null,
  description       text not null check (length(trim(description)) between 2 and 300),
  supplier          text,
  payment_method_id uuid,
  voided_at         timestamptz,                          -- annulation tracée plutôt que suppression
  void_reason       text,
  recorded_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (organization_id, payment_method_id) references public.payment_methods (organization_id, id) on delete restrict,
  check (voided_at is null or void_reason is not null)
);
create index expenses_org_date_idx on public.expenses (organization_id, spent_on desc) where voided_at is null;
create trigger expenses_touch before update on public.expenses for each row execute function private.touch_updated_at();
create trigger expenses_audit after insert or update on public.expenses for each row execute function private.audit_trigger();
