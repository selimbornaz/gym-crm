-- =============================================================================
-- 0003 · Présences, programmes d'entraînement, progression, planning,
--        réservations, équipements, notifications.
-- =============================================================================

create type public.checkin_method as enum ('search', 'member_code', 'qr', 'manual');
create type public.attendance_status as enum ('valid', 'voided');
create type public.program_status as enum ('draft', 'active', 'completed', 'archived');
create type public.session_kind as enum ('group_class', 'personal_training');
create type public.session_status as enum ('scheduled', 'cancelled', 'completed');
create type public.booking_status as enum ('booked', 'cancelled', 'attended', 'no_show');
create type public.equipment_condition as enum ('new', 'good', 'fair', 'poor', 'out_of_service');

-- -----------------------------------------------------------------------------
-- Présences
-- -----------------------------------------------------------------------------
create table public.attendance (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  member_id         uuid not null,
  checked_in_at     timestamptz not null default now(),
  checked_out_at    timestamptz,
  method            public.checkin_method not null,
  status            public.attendance_status not null default 'valid',
  override_reason   text,                                 -- entrée accordée malgré un abonnement invalide
  correction_reason text,
  recorded_by       uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organization_id, id),
  check (checked_out_at is null or checked_out_at > checked_in_at),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade
);
create index attendance_org_time_idx on public.attendance (organization_id, checked_in_at desc);
create index attendance_member_idx on public.attendance (organization_id, member_id, checked_in_at desc);
create trigger attendance_touch before update on public.attendance for each row execute function private.touch_updated_at();
create trigger attendance_audit after update or delete on public.attendance for each row execute function private.audit_trigger();

-- -----------------------------------------------------------------------------
-- Programmes d'entraînement
-- -----------------------------------------------------------------------------
create table public.workout_programs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid,                                   -- NULL = modèle réutilisable
  coach_id        uuid,
  name            text not null check (length(trim(name)) between 2 and 120),
  goal            text,
  start_date      date,
  end_date        date,
  status          public.program_status not null default 'draft',
  notes           text,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (end_date is null or start_date is null or end_date >= start_date),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade,
  foreign key (organization_id, coach_id) references public.coaches (organization_id, id) on delete set null (coach_id)
);
create index programs_member_idx on public.workout_programs (organization_id, member_id);
create index programs_coach_idx on public.workout_programs (organization_id, coach_id);
create trigger programs_touch before update on public.workout_programs for each row execute function private.touch_updated_at();

create table public.workout_days (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  program_id      uuid not null,
  day_number      int not null check (day_number between 1 and 14),
  title           text not null check (length(trim(title)) between 1 and 80),
  muscle_group    text,
  position        int not null default 0,
  unique (organization_id, id),
  foreign key (organization_id, program_id) references public.workout_programs (organization_id, id) on delete cascade
);
create index workout_days_program_idx on public.workout_days (organization_id, program_id, position);

create table public.workout_exercises (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  day_id          uuid not null,
  name            text not null check (length(trim(name)) between 1 and 120),
  sets            int check (sets is null or sets between 1 and 50),
  reps            text,                                   -- « 8-12 », « 30 s », « max »
  rest_seconds    int check (rest_seconds is null or rest_seconds between 0 and 900),
  load            text,                                   -- « 20 kg », « RPE 8 »
  instructions    text,
  position        int not null default 0,
  foreign key (organization_id, day_id) references public.workout_days (organization_id, id) on delete cascade
);
create index workout_exercises_day_idx on public.workout_exercises (organization_id, day_id, position);

create table public.workout_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  program_id      uuid not null,
  member_id       uuid not null,
  day_id          uuid,
  performed_on    date not null,
  completed       boolean not null default true,
  notes           text,
  recorded_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, program_id) references public.workout_programs (organization_id, id) on delete cascade,
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade,
  foreign key (organization_id, day_id) references public.workout_days (organization_id, id) on delete set null (day_id)
);
create index workout_logs_member_idx on public.workout_logs (organization_id, member_id, performed_on desc);

-- Mesures et notes de progression : données sensibles (propriétaire + coach assigné).
create table public.progress_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  member_id       uuid not null,
  recorded_on     date not null,
  weight_kg       numeric(5, 2) check (weight_kg is null or weight_kg between 20 and 400),
  body_fat_pct    numeric(4, 1) check (body_fat_pct is null or body_fat_pct between 2 and 70),
  waist_cm        numeric(5, 1),
  chest_cm        numeric(5, 1),
  arm_cm          numeric(5, 1),
  thigh_cm        numeric(5, 1),
  notes           text,
  recorded_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade
);
create index progress_member_idx on public.progress_entries (organization_id, member_id, recorded_on desc);

-- -----------------------------------------------------------------------------
-- Planning : cours collectifs et séances de coaching individuel
-- -----------------------------------------------------------------------------
create table public.sessions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind            public.session_kind not null,
  title           text not null check (length(trim(title)) between 2 and 120),
  coach_id        uuid,
  room            text,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  capacity        int not null check (capacity between 1 and 500),
  status          public.session_status not null default 'scheduled',
  notes           text,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  check (kind <> 'personal_training' or capacity = 1),
  foreign key (organization_id, coach_id) references public.coaches (organization_id, id) on delete set null (coach_id),
  -- Un coach ne peut pas animer deux séances qui se chevauchent.
  constraint sessions_no_coach_overlap exclude using gist (
    organization_id with =, coach_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled' and coach_id is not null)
);
create index sessions_org_start_idx on public.sessions (organization_id, starts_at);
create trigger sessions_touch before update on public.sessions for each row execute function private.touch_updated_at();

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  session_id      uuid not null,
  member_id       uuid not null,
  status          public.booking_status not null default 'booked',
  cancelled_at    timestamptz,
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (session_id, member_id),
  foreign key (organization_id, session_id) references public.sessions (organization_id, id) on delete cascade,
  foreign key (organization_id, member_id) references public.members (organization_id, id) on delete cascade
);
create index bookings_session_idx on public.bookings (organization_id, session_id, status);
create index bookings_member_idx on public.bookings (organization_id, member_id);
create trigger bookings_touch before update on public.bookings for each row execute function private.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Équipements et maintenance
-- -----------------------------------------------------------------------------
create table public.equipment (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  name                text not null check (length(trim(name)) between 2 and 120),
  category            text not null default 'Autre',
  quantity            int not null default 1 check (quantity >= 0),
  purchase_date       date,
  purchase_cost       numeric(12, 3) check (purchase_cost is null or purchase_cost >= 0),
  condition           public.equipment_condition not null default 'good',
  location            text,
  next_maintenance_on date,
  notes               text,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (organization_id, id)
);
create index equipment_maintenance_due_idx on public.equipment (organization_id, next_maintenance_on) where archived_at is null;
create trigger equipment_touch before update on public.equipment for each row execute function private.touch_updated_at();

create table public.equipment_maintenance (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  equipment_id    uuid not null,
  performed_on    date not null,
  description     text not null check (length(trim(description)) between 2 and 500),
  cost            numeric(12, 3) check (cost is null or cost >= 0),
  performed_by    text,
  next_due_on     date,
  recorded_by     uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now(),
  foreign key (organization_id, equipment_id) references public.equipment (organization_id, id) on delete cascade
);
create index maintenance_equipment_idx on public.equipment_maintenance (organization_id, equipment_id, performed_on desc);

/** Une maintenance enregistrée met à jour la prochaine échéance de l'équipement. */
create function private.maintenance_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.equipment
  set next_maintenance_on = new.next_due_on
  where organization_id = new.organization_id and id = new.equipment_id;
  return new;
end;
$$;
create trigger maintenance_after_insert after insert on public.equipment_maintenance
  for each row execute function private.maintenance_after_insert();

-- -----------------------------------------------------------------------------
-- Notifications in-app (une ligne par destinataire)
-- -----------------------------------------------------------------------------
create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  recipient_user_id uuid not null references auth.users (id) on delete cascade,
  type              text not null,
  title             text not null,
  body              text,
  link              text,
  dedupe_key        text not null,                        -- évite les doublons lors des recalculs
  read_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (organization_id, recipient_user_id, dedupe_key)
);
create index notifications_recipient_idx on public.notifications (recipient_user_id, organization_id, created_at desc);

create table public.announcements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (length(trim(title)) between 2 and 160),
  body            text not null check (length(trim(body)) between 2 and 4000),
  created_by      uuid references auth.users (id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
