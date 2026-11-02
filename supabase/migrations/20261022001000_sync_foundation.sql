-- =============================================================================
-- 0010 · Fondations de la synchronisation avec l'application de bureau.
-- =============================================================================
-- Migration purement additive : l'application web n'a rien à changer.
--  * sync_devices        : postes enregistrés, chacun avec sa série de numéros.
--  * sync_changelog      : journal numéroté de tous les changements (suppressions
--                          comprises). Le poste lit « tout depuis le n° X », puis
--                          relit les lignes via l'API : la RLS s'applique donc.
--  * row_version         : version de ligne attribuée par le serveur (les horloges
--                          des postes ne servent jamais à départager).
--  * sync_ops            : opérations rejouées (idempotence, file de revue).
--  * sync_apply_op       : rejoue une opération hors ligne en passant par les mêmes
--                          RPC, RLS et triggers que le web. PostgreSQL reste l'arbitre.
-- Les réglages app.sync_* ne sont posés que par sync_apply_op : PostgREST n'expose
-- pas set_config, un client ne peut donc pas les falsifier.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Version de ligne
-- -----------------------------------------------------------------------------
create function private.sync_bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'organization_settings', 'profiles', 'staff', 'coaches', 'members', 'member_notes',
    'leads', 'membership_plans', 'subscriptions', 'payment_methods', 'expenses', 'attendance',
    'workout_programs', 'workout_days', 'workout_exercises', 'workout_logs', 'progress_entries',
    'sessions', 'bookings', 'equipment', 'equipment_maintenance', 'notifications', 'announcements'
  ] loop
    execute format('alter table public.%I add column row_version bigint not null default 1', t);
    execute format('create trigger sync_bump_version before update on public.%I
      for each row execute function private.sync_bump_version()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Journal des changements
-- -----------------------------------------------------------------------------
create table private.sync_changelog (
  seq             bigint generated always as identity primary key,
  organization_id uuid not null,
  table_name      text not null,
  row_id          text not null,
  op              char(1) not null check (op in ('I', 'U', 'D')),
  changed_at      timestamptz not null default now()
);
create index sync_changelog_org_seq_idx on private.sync_changelog (organization_id, seq);

-- Numéro jusqu'auquel le journal a été purgé : en deçà, le poste doit tout relire.
create table private.sync_state (
  organization_id uuid primary key,
  pruned_through  bigint not null default 0
);

/**
 * Trigger DIFFÉRÉ à la validation, verrou par salle : les numéros suivent ainsi
 * l'ordre de validation. Un poste ne peut donc pas dépasser un changement encore
 * en cours. Aucun blocage croisé possible : plus aucune ligne n'est verrouillée après.
 */
create function private.sync_log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_op char(1) := left(tg_op, 1);
  v_org uuid;
begin
  if tg_table_name = 'profiles' then
    for v_org in
      select s.organization_id from public.staff s where s.user_id = (rec ->> 'id')::uuid order by 1
    loop
      perform pg_advisory_xact_lock(hashtextextended('sync:' || v_org::text, 0));
      insert into private.sync_changelog (organization_id, table_name, row_id, op)
      values (v_org, tg_table_name, rec ->> 'id', v_op);
    end loop;
    return null;
  end if;

  v_org := (case when tg_table_name = 'organizations' then rec ->> 'id' else rec ->> 'organization_id' end)::uuid;
  perform pg_advisory_xact_lock(hashtextextended('sync:' || v_org::text, 0));
  insert into private.sync_changelog (organization_id, table_name, row_id, op)
  values (v_org, tg_table_name,
          case when tg_table_name = 'organization_settings' then rec ->> 'organization_id' else rec ->> 'id' end,
          v_op);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'organization_settings', 'profiles', 'staff', 'audit_logs', 'coaches', 'members',
    'member_notes', 'leads', 'membership_plans', 'subscriptions', 'subscription_events', 'payment_methods',
    'payments', 'payment_adjustments', 'expenses', 'attendance', 'workout_programs', 'workout_days',
    'workout_exercises', 'workout_logs', 'progress_entries', 'sessions', 'bookings', 'equipment',
    'equipment_maintenance', 'notifications', 'announcements'
  ] loop
    execute format('create constraint trigger sync_log_change after insert or update or delete on public.%I
      deferrable initially deferred for each row execute function private.sync_log_change()', t);
  end loop;
end $$;

/** Purge du journal (tâche planifiée) ; les postes trop en retard relisent tout. */
create function private.sync_prune(p_keep interval default interval '180 days') returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select c.organization_id, max(c.seq) as last_seq from private.sync_changelog c
    where c.changed_at < now() - p_keep group by 1
  loop
    delete from private.sync_changelog c where c.organization_id = r.organization_id and c.seq <= r.last_seq;
    insert into private.sync_state as s (organization_id, pruned_through) values (r.organization_id, r.last_seq)
    on conflict (organization_id) do update set pruned_through = greatest(s.pruned_through, excluded.pruned_through);
  end loop;
end;
$$;

/**
 * Changements depuis p_since. Ne renvoie que des identifiants : le contenu est relu
 * via l'API sous RLS, et une ligne devenue invisible est retirée du poste.
 * p_since NULL : renvoie seulement le numéro courant (à prendre AVANT une copie complète).
 */
create function public.sync_changes(p_org uuid, p_since bigint default null, p_limit int default 500) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_head bigint;
  v_pruned bigint;
  v_rows jsonb;
  v_next bigint;
  v_count int;
begin
  if not private.is_staff_of(p_org) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  select coalesce(max(c.seq), 0) into v_head from private.sync_changelog c where c.organization_id = p_org;
  select coalesce((select s.pruned_through from private.sync_state s where s.organization_id = p_org), 0) into v_pruned;
  -- Journal entièrement purgé : le numéro courant ne doit jamais redescendre.
  v_head := greatest(v_head, v_pruned);

  if p_since is null then
    return jsonb_build_object('head', v_head, 'next_since', v_head, 'changes', '[]'::jsonb, 'has_more', false, 'resync_required', false);
  end if;
  if p_since < v_pruned then
    return jsonb_build_object('head', v_head, 'next_since', p_since, 'changes', '[]'::jsonb, 'has_more', false, 'resync_required', true);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('seq', p.seq, 'table', p.table_name, 'id', p.row_id, 'op', p.op) order by p.seq), '[]'::jsonb),
         max(p.seq), count(*)
  into v_rows, v_next, v_count
  from (
    select c.seq, c.table_name, c.row_id, c.op from private.sync_changelog c
    where c.organization_id = p_org and c.seq > p_since
    order by c.seq limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  ) p;

  return jsonb_build_object('head', v_head, 'next_since', coalesce(v_next, p_since), 'changes', v_rows,
    'has_more', coalesce(v_next, p_since) < v_head, 'resync_required', false);
end;
$$;

-- -----------------------------------------------------------------------------
-- Postes enregistrés
-- -----------------------------------------------------------------------------
create table public.sync_devices (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  id              uuid not null,
  series          text not null check (series ~ '^[A-Z]{1,4}$'),
  name            text,
  user_id         uuid references auth.users (id) on delete set null,
  registered_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  revoked_at      timestamptz,
  primary key (organization_id, id),
  unique (organization_id, series)
);
create trigger sync_devices_audit after update on public.sync_devices
  for each row when (old.revoked_at is distinct from new.revoked_at)
  execute function private.audit_trigger();

/** 1 -> A, 26 -> Z, 27 -> AA. */
create function private.sync_series_label(n bigint) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_label text := '';
  v_n bigint := n;
begin
  while v_n > 0 loop
    v_label := chr(65 + ((v_n - 1) % 26)::int) || v_label;
    v_n := (v_n - 1) / 26;
  end loop;
  return v_label;
end;
$$;

/** Enregistre le poste (idempotent) et lui attribue sa série permanente. */
create function public.sync_register_device(p_org uuid, p_device uuid, p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.sync_devices;
  v_settings public.organization_settings;
  v_head bigint;
begin
  if not private.is_staff_of(p_org) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  select * into v from public.sync_devices d where d.organization_id = p_org and d.id = p_device for update;
  if found then
    if v.revoked_at is not null then raise exception 'Ce poste a été révoqué' using errcode = '42501'; end if;
    update public.sync_devices d set user_id = auth.uid(), last_seen_at = now(), name = coalesce(nullif(trim(p_name), ''), d.name)
    where d.organization_id = p_org and d.id = p_device;
  else
    insert into public.sync_devices (organization_id, id, series, name, user_id)
    values (p_org, p_device, private.sync_series_label(private.next_counter(p_org, 'device_series')), nullif(trim(p_name), ''), auth.uid())
    returning * into v;
  end if;

  select * into v_settings from public.organization_settings s where s.organization_id = p_org;
  select greatest(coalesce(max(c.seq), 0),
    coalesce((select s.pruned_through from private.sync_state s where s.organization_id = p_org), 0))
  into v_head from private.sync_changelog c where c.organization_id = p_org;
  return jsonb_build_object('series', v.series, 'member_code_prefix', v_settings.member_code_prefix,
    'receipt_prefix', v_settings.receipt_prefix, 'head', v_head);
end;
$$;

/** Coupe l'accès d'un poste (perdu, volé) : ses opérations ne sont plus acceptées. */
create function public.sync_revoke_device(p_org uuid, p_device uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission(p_org, 'settings.manage');
  update public.sync_devices d set revoked_at = coalesce(d.revoked_at, now())
  where d.organization_id = p_org and d.id = p_device;
  if not found then raise exception 'Poste introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Opérations rejouées
-- -----------------------------------------------------------------------------
create table public.sync_ops (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  op_id           uuid not null,
  device_id       uuid not null,
  user_id         uuid references auth.users (id) on delete set null,
  kind            text not null,
  args            jsonb not null default '{}',
  occurred_at     timestamptz,
  status          text not null check (status in ('pending', 'applied', 'conflict', 'rejected')),
  result          jsonb,
  conflicts       jsonb,
  error_code      text,
  error_message   text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users (id) on delete set null,
  primary key (organization_id, op_id)
);
create index sync_ops_review_idx on public.sync_ops (organization_id, created_at desc)
  where status in ('conflict', 'rejected') and resolved_at is null;

/** Série du poste ; refuse un poste inconnu ou révoqué. */
create function private.sync_device_series(p_org uuid, p_device uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v public.sync_devices;
begin
  select * into v from public.sync_devices d where d.organization_id = p_org and d.id = p_device;
  if not found then raise exception 'Poste non enregistré' using errcode = '42501'; end if;
  if v.revoked_at is not null then raise exception 'Ce poste a été révoqué' using errcode = '42501'; end if;
  update public.sync_devices d set last_seen_at = now() where d.organization_id = p_org and d.id = p_device;
  return v.series;
end;
$$;

/** Réserve l'opération. Renvoie la ligne : statut « pending » si elle est nouvelle. */
create function private.sync_op_claim(
  p_org uuid, p_op uuid, p_device uuid, p_kind text, p_args jsonb, p_occurred_at timestamptz
) returns public.sync_ops
language plpgsql security definer set search_path = '' as $$
declare v public.sync_ops;
begin
  insert into public.sync_ops (organization_id, op_id, device_id, user_id, kind, args, occurred_at, status)
  values (p_org, p_op, p_device, auth.uid(), p_kind, coalesce(p_args, '{}'), p_occurred_at, 'pending')
  on conflict (organization_id, op_id) do nothing;
  select * into v from public.sync_ops o where o.organization_id = p_org and o.op_id = p_op;
  if v.user_id is distinct from auth.uid() then
    raise exception 'Opération déjà utilisée par un autre compte' using errcode = '42501';
  end if;
  return v;
end;
$$;

create function private.sync_op_finish(
  p_org uuid, p_op uuid, p_status text, p_result jsonb, p_conflicts jsonb, p_code text, p_message text
) returns void
language sql security definer set search_path = '' as $$
  update public.sync_ops o
  set status = p_status, result = p_result, conflicts = p_conflicts, error_code = p_code, error_message = p_message
  where o.organization_id = p_org and o.op_id = p_op;
$$;

/** Résout un request_id hors ligne vers l'identifiant serveur (ou l'identifiant tel quel). */
create function private.sync_subscription_id(p_org uuid, a jsonb) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((a ->> 'subscription')::uuid,
    (select s.id from public.subscriptions s
     where s.organization_id = p_org and s.request_id = (a ->> 'subscription_request')::uuid));
$$;

create function private.sync_payment_id(p_org uuid, a jsonb) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce((a ->> 'payment')::uuid,
    (select p.id from public.payments p
     where p.organization_id = p_org and p.request_id = (a ->> 'payment_request')::uuid));
$$;

/**
 * Applique une modification de ligne, SOUS LA RLS de l'appelant (fonction invoker).
 * Fusion champ par champ : un champ modifié ailleurs depuis la copie du poste n'est
 * jamais écrasé ; il est signalé dans `conflicts` et le reste est appliqué.
 */
create function private.sync_apply_row(p_org uuid, p_kind text, a jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_table text := a ->> 'table';
  v_id text := a ->> 'id';
  v_where text;
  v_columns text[];
  v_forbidden text[] := array['id', 'organization_id', 'created_at', 'updated_at', 'row_version', 'created_by', 'recorded_by'];
  v_values jsonb;
  v_row jsonb;
  v_apply jsonb := '{}';
  v_conflicts jsonb := '[]';
  v_key text;
  v_list text;
  v_count int;
begin
  if v_table is null then
    raise exception 'Table manquante' using errcode = '22023';
  end if;
  if p_kind = 'row.insert' and not (v_table = any (array[
    'coaches', 'members', 'member_notes', 'leads', 'membership_plans', 'payment_methods', 'expenses',
    'workout_programs', 'workout_days', 'workout_exercises', 'workout_logs', 'progress_entries',
    'sessions', 'equipment', 'equipment_maintenance', 'announcements'
  ])) or p_kind = 'row.update' and not (v_table = any (array[
    'organizations', 'organization_settings', 'coaches', 'members', 'leads', 'membership_plans', 'payment_methods',
    'expenses', 'workout_programs', 'workout_days', 'workout_exercises', 'sessions', 'bookings', 'equipment', 'notifications'
  ])) or p_kind = 'row.delete' and not (v_table = any (array[
    'member_notes', 'leads', 'workout_programs', 'workout_days', 'workout_exercises', 'workout_logs', 'progress_entries'
  ])) then
    raise exception 'Table non autorisée pour cette opération : %', v_table using errcode = '42501';
  end if;
  if private.try_uuid(v_id) is null and v_table not in ('organizations', 'organization_settings') then
    raise exception 'Identifiant invalide' using errcode = '22023';
  end if;

  select array_agg(att.attname::text) into v_columns
  from pg_catalog.pg_attribute att
  where att.attrelid = format('public.%I', v_table)::regclass and att.attnum > 0
    and not att.attisdropped and att.attgenerated = '';

  v_where := case v_table
    when 'organizations' then format('id = %L', p_org)
    when 'organization_settings' then format('organization_id = %L', p_org)
    else format('organization_id = %L and id = %L', p_org, v_id)
  end;

  if p_kind = 'row.insert' then
    v_values := coalesce(a -> 'values', '{}');
    for v_key in select jsonb_object_keys(v_values) loop
      -- Le code membre n'est conservé par le trigger que s'il est dans la série du poste.
      if not v_key = any (v_columns) or (v_key = any (v_forbidden)) then
        raise exception 'Champ non autorisé : %', v_key using errcode = '42501';
      end if;
    end loop;
    v_values := v_values || jsonb_build_object('organization_id', p_org, 'id', v_id);
    select string_agg(format('%I', k), ', ') into v_list from jsonb_object_keys(v_values) k;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (id) do nothing',
      v_table, v_list, v_list, v_table) using v_values;
    get diagnostics v_count = row_count;
    return jsonb_build_object('inserted', v_count = 1);
  end if;

  if p_kind = 'row.delete' then
    execute format('select to_jsonb(t) from public.%I t where %s for update', v_table, v_where) into v_row;
    if v_row is null then
      return jsonb_build_object('deleted', false, 'reason', 'absent');
    end if;
    if (a ->> 'base_version') is null or (v_row ->> 'row_version')::bigint > (a ->> 'base_version')::bigint then
      return jsonb_build_object('deleted', false, 'conflicts', jsonb_build_array(
        jsonb_build_object('field', '*', 'base_version', a -> 'base_version', 'server', v_row)));
    end if;
    execute format('delete from public.%I where %s', v_table, v_where);
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Suppression refusée' using errcode = '42501'; end if;
    return jsonb_build_object('deleted', true);
  end if;

  -- row.update
  execute format('select to_jsonb(t) from public.%I t where %s for update', v_table, v_where) into v_row;
  if v_row is null then
    raise exception 'Ligne introuvable ou accès refusé' using errcode = 'P0002';
  end if;
  v_values := coalesce(a -> 'changes', '{}');
  for v_key in select jsonb_object_keys(v_values) loop
    if not v_key = any (v_columns) or v_key = any (v_forbidden) or v_key = 'member_code' then
      raise exception 'Champ non autorisé : %', v_key using errcode = '42501';
    end if;
    if not (coalesce(a -> 'base', '{}') ? v_key) then
      raise exception 'Valeur de référence manquante pour %', v_key using errcode = '22023';
    end if;
    if (v_row -> v_key) is not distinct from (v_values -> v_key) then
      continue;                                   -- déjà à la bonne valeur
    elsif (v_row -> v_key) is not distinct from (a -> 'base' -> v_key) then
      v_apply := v_apply || jsonb_build_object(v_key, v_values -> v_key);
    else
      v_conflicts := v_conflicts || jsonb_build_object('field', v_key, 'base', a -> 'base' -> v_key,
        'offline', v_values -> v_key, 'server', v_row -> v_key);
    end if;
  end loop;

  if v_apply <> '{}' then
    select string_agg(format('%I', k), ', ') into v_list from jsonb_object_keys(v_apply) k;
    execute format('update public.%I t set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s',
      v_table, v_list, v_list, v_table, v_where) using v_apply;
    get diagnostics v_count = row_count;
    if v_count = 0 then raise exception 'Modification refusée' using errcode = '42501'; end if;
  end if;
  return jsonb_build_object('applied', v_apply, 'conflicts', v_conflicts);
end;
$$;

/** Aiguillage vers les RPC existantes : mêmes permissions, mêmes règles que le web. */
create function private.sync_dispatch(p_org uuid, p_kind text, a jsonb, p_occurred_at timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_uuid uuid;
  v_receipt text;
begin
  case p_kind
    when 'check_in' then
      return public.check_in(p_org, (a ->> 'member')::uuid, (a ->> 'method')::public.checkin_method, a ->> 'override_reason');
    when 'check_out' then
      perform public.check_out(p_org, (a ->> 'attendance')::uuid);
      return '{}'::jsonb;
    when 'correct_attendance' then
      perform public.correct_attendance(p_org, (a ->> 'attendance')::uuid, a ->> 'reason', (a ->> 'void')::boolean,
        (a ->> 'checked_in_at')::timestamptz, (a ->> 'checked_out_at')::timestamptz);
      return '{}'::jsonb;
    when 'create_subscription' then
      v_uuid := public.create_subscription(p_org, (a ->> 'member')::uuid, (a ->> 'plan')::uuid, (a ->> 'request_id')::uuid,
        (a ->> 'start')::date, coalesce((a ->> 'discount')::numeric, 0), a ->> 'notes');
      return jsonb_build_object('subscription_id', v_uuid);
    when 'suspend_subscription' then
      perform public.suspend_subscription(p_org, private.sync_subscription_id(p_org, a), a ->> 'reason');
      return '{}'::jsonb;
    when 'resume_subscription' then
      perform public.resume_subscription(p_org, private.sync_subscription_id(p_org, a), a ->> 'reason');
      return '{}'::jsonb;
    when 'cancel_subscription' then
      perform public.cancel_subscription(p_org, private.sync_subscription_id(p_org, a), a ->> 'reason');
      return '{}'::jsonb;
    when 'extend_subscription' then
      perform public.extend_subscription(p_org, private.sync_subscription_id(p_org, a), (a ->> 'days')::int, a ->> 'reason');
      return '{}'::jsonb;
    when 'record_payment' then
      perform set_config('app.sync_receipt', coalesce(a ->> 'receipt_number', ''), true);
      select r.payment_id, r.receipt_number into v_uuid, v_receipt
      from public.record_payment(p_org, (a ->> 'member')::uuid, (a ->> 'method')::uuid, (a ->> 'amount')::numeric,
        (a ->> 'request_id')::uuid, private.sync_subscription_id(p_org, a), p_occurred_at, a ->> 'reference', a ->> 'notes') r;
      return jsonb_build_object('payment_id', v_uuid, 'receipt_number', v_receipt);
    when 'refund_payment' then
      v_uuid := public.refund_payment(p_org, private.sync_payment_id(p_org, a), (a ->> 'type')::public.adjustment_type,
        (a ->> 'amount')::numeric, a ->> 'reason', (a ->> 'request_id')::uuid, (a ->> 'method')::uuid);
      return jsonb_build_object('adjustment_id', v_uuid);
    when 'book_session' then
      v_uuid := public.book_session(p_org, (a ->> 'session')::uuid, (a ->> 'member')::uuid);
      return jsonb_build_object('booking_id', v_uuid);
    when 'cancel_booking' then
      perform public.cancel_booking(p_org, (a ->> 'booking')::uuid);
      return '{}'::jsonb;
    when 'row.insert', 'row.update', 'row.delete' then
      return private.sync_apply_row(p_org, p_kind, a);
    else
      raise exception 'Opération inconnue : %', p_kind using errcode = '22023';
  end case;
end;
$$;

/**
 * Rejoue UNE opération hors ligne (une transaction par appel).
 * Idempotent : un second envoi du même op_id renvoie le premier résultat.
 * Un refus métier n'est pas une erreur de transport : il est enregistré pour revue
 * (statut rejected) et l'opération suivante peut passer.
 */
create function public.sync_apply_op(
  p_org uuid, p_device uuid, p_op_id uuid, p_kind text,
  p_args jsonb default '{}', p_occurred_at timestamptz default null
) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_series text;
  v_op public.sync_ops;
  v_result jsonb;
  v_conflicts jsonb;
  v_status text := 'applied';
  v_code text;
  v_message text;
begin
  if auth.uid() is null then raise exception 'Authentification requise' using errcode = '28000'; end if;
  v_series := private.sync_device_series(p_org, p_device);
  v_op := private.sync_op_claim(p_org, p_op_id, p_device, p_kind, p_args, p_occurred_at);
  if v_op.status <> 'pending' then
    return jsonb_build_object('status', v_op.status, 'replayed', true, 'result', v_op.result,
      'conflicts', v_op.conflicts, 'error_code', v_op.error_code, 'error_message', v_op.error_message);
  end if;

  begin
    if not private.is_staff_of(p_org) then
      raise exception 'Compte désactivé ou sans accès à cette salle' using errcode = '42501';
    end if;
    if p_occurred_at > now() + interval '5 minutes' then
      raise exception 'Date dans le futur : vérifiez l''horloge de ce poste' using errcode = '22023';
    end if;
    if p_occurred_at < now() - interval '30 days' then
      raise exception 'Opération hors ligne trop ancienne (plus de 30 jours)' using errcode = '22023';
    end if;
    perform set_config('app.sync_replay', 'on', true);
    perform set_config('app.sync_series', v_series, true);
    perform set_config('app.sync_occurred_at', coalesce(p_occurred_at::text, ''), true);
    perform set_config('app.sync_row_id', coalesce(p_args ->> 'row_id', ''), true);

    v_result := private.sync_dispatch(p_org, p_kind, coalesce(p_args, '{}'), p_occurred_at);
    v_conflicts := v_result -> 'conflicts';
    if v_conflicts is not null and jsonb_array_length(v_conflicts) > 0 then
      v_status := 'conflict';
    end if;
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_message = message_text;
    v_status := 'rejected';
    v_result := null;
    v_conflicts := null;
  end;

  perform set_config('app.sync_replay', '', true);
  perform set_config('app.sync_series', '', true);
  perform set_config('app.sync_occurred_at', '', true);
  perform set_config('app.sync_row_id', '', true);
  perform set_config('app.sync_receipt', '', true);

  perform private.sync_op_finish(p_org, p_op_id, v_status, v_result, v_conflicts, v_code, v_message);
  return jsonb_build_object('status', v_status, 'replayed', false, 'result', v_result,
    'conflicts', v_conflicts, 'error_code', v_code, 'error_message', v_message);
end;
$$;

/** Marque une opération refusée ou en conflit comme traitée (écran de revue). */
create function public.sync_resolve_op(p_org uuid, p_op uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.sync_ops o
    where o.organization_id = p_org and o.op_id = p_op
      and (o.user_id = auth.uid() or private.has_permission(p_org, 'settings.manage'))
      and private.is_staff_of(p_org)
  ) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  update public.sync_ops o set resolved_at = now(), resolved_by = auth.uid()
  where o.organization_id = p_org and o.op_id = p_op and o.resolved_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Numéros par poste et heure réelle : les fonctions gardent leur signature
-- et leur comportement web ; seuls les rejeux (app.sync_*) changent.
-- -----------------------------------------------------------------------------
create or replace function private.members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
  v_series text := nullif(current_setting('app.sync_series', true), '');
begin
  select s.member_code_prefix into prefix from public.organization_settings s where s.organization_id = new.organization_id;
  -- Code du poste accepté uniquement lors d'un rejeu et dans la série de CE poste.
  if not coalesce(current_setting('app.sync_replay', true) = 'on' and v_series is not null
          and new.member_code ~ ('^' || coalesce(prefix, 'M') || '-' || v_series || '-[0-9]{6}$'), false) then
    new.member_code := coalesce(prefix, 'M') || '-' || lpad(private.next_counter(new.organization_id, 'member')::text, 6, '0');
  end if;
  new.registered_on := coalesce(new.registered_on, private.org_today(new.organization_id));
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

create or replace function public.record_payment(
  p_org uuid, p_member uuid, p_method uuid, p_amount numeric, p_request_id uuid,
  p_subscription uuid default null, p_paid_at timestamptz default null,
  p_reference text default null, p_notes text default null
) returns table (payment_id uuid, receipt_number text)
language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.payments;
  v_sub public.subscriptions;
  v_prefix text;
  v_receipt text;
  v_id uuid;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_replay boolean := coalesce(current_setting('app.sync_replay', true) = 'on', false);
  v_series text := nullif(current_setting('app.sync_series', true), '');
  v_supplied text := nullif(current_setting('app.sync_receipt', true), '');
begin
  perform private.require_permission(p_org, 'payments.create');

  select * into v_existing from public.payments p where p.organization_id = p_org and p.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.receipt_number;
    return;
  end if;

  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 3) then
    raise exception 'Montant invalide (positif, 3 décimales max.)' using errcode = '22023';
  end if;
  if v_paid_at > now() + interval '5 minutes' then
    raise exception 'La date de paiement ne peut pas être dans le futur' using errcode = '22023';
  end if;
  -- Un rejeu porte l'heure réelle de l'encaissement hors ligne (borne dans sync_apply_op).
  if not v_replay and v_paid_at < now() - interval '1 day' and not private.has_permission(p_org, 'reports.financial') then
    raise exception 'Seul le propriétaire peut antidater un paiement' using errcode = '42501';
  end if;

  if not exists (select 1 from public.members m where m.organization_id = p_org and m.id = p_member) then
    raise exception 'Membre introuvable' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.payment_methods pm where pm.organization_id = p_org and pm.id = p_method and pm.is_active) then
    raise exception 'Moyen de paiement invalide' using errcode = '22023';
  end if;

  if p_subscription is not null then
    v_sub := private.lock_subscription(p_org, p_subscription);
    if v_sub.member_id <> p_member then raise exception 'Abonnement d''un autre membre' using errcode = '22023'; end if;
    if v_sub.status = 'cancelled' then raise exception 'Abonnement annulé' using errcode = '22023'; end if;
    if p_amount > v_sub.total_due - v_sub.amount_paid then
      raise exception 'Le montant dépasse le reste à payer (%)', private.fmt_dt(v_sub.total_due - v_sub.amount_paid)
        using errcode = '22023';
    end if;
  end if;

  select s.receipt_prefix into v_prefix from public.organization_settings s where s.organization_id = p_org;
  -- Numéro du poste accepté uniquement lors d'un rejeu et dans la série de CE poste.
  if coalesce(v_replay and v_series is not null
     and v_supplied ~ ('^' || coalesce(v_prefix, 'R') || '-' || v_series || '-[0-9]{4}-[0-9]{6}$'), false) then
    v_receipt := v_supplied;
  else
    v_receipt := coalesce(v_prefix, 'R') || '-' || to_char(v_paid_at at time zone
        (select o.timezone from public.organizations o where o.id = p_org), 'YYYY') || '-'
      || lpad(private.next_counter(p_org, 'receipt')::text, 6, '0');
  end if;

  insert into public.payments (
    organization_id, member_id, subscription_id, method_id, amount, paid_at, receipt_number,
    reference, notes, recorded_by, request_id
  ) values (
    p_org, p_member, p_subscription, p_method, p_amount, v_paid_at, v_receipt,
    nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), auth.uid(), p_request_id
  ) returning id into v_id;

  if p_subscription is not null then
    perform private.refresh_subscription_paid(p_org, p_subscription);
  end if;

  return query select v_id, v_receipt;
end;
$$;

create or replace function public.check_in(
  p_org uuid, p_member uuid, p_method public.checkin_method, p_override_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_replay boolean := coalesce(current_setting('app.sync_replay', true) = 'on', false);
  v_row_id uuid := private.try_uuid(current_setting('app.sync_row_id', true));
  v_at timestamptz := coalesce(nullif(current_setting('app.sync_occurred_at', true), '')::timestamptz, now());
  v_today date := (v_at at time zone coalesce(
    (select o.timezone from public.organizations o where o.id = p_org), 'Africa/Tunis'))::date;
  v_debounce int;
  v_plan_name text;
  v_sub_end date;
  v_sub_status public.subscription_status;
  v_restrictions text;
  v_recent public.attendance;
  v_denial text;
  v_attendance_id uuid;
  v_payload jsonb;
  v_reason text;
begin
  perform private.require_permission(p_org, 'attendance.write');

  select * into v_member from public.members m where m.organization_id = p_org and m.id = p_member for update;
  if not found then raise exception 'Membre introuvable' using errcode = 'P0002'; end if;

  select s.plan_name, s.end_date, s.status, p.access_restrictions
  into v_plan_name, v_sub_end, v_sub_status, v_restrictions
  from public.subscriptions s
  join public.membership_plans p on p.organization_id = s.organization_id and p.id = s.plan_id
  where s.organization_id = p_org and s.member_id = p_member and s.kind in ('membership', 'pass')
    and s.status <> 'cancelled' and s.start_date <= v_today and s.end_date >= v_today
  order by s.end_date desc
  limit 1;

  v_payload := jsonb_build_object(
    'member', jsonb_build_object(
      'id', v_member.id, 'code', v_member.member_code,
      'name', v_member.first_name || ' ' || v_member.last_name, 'photo_path', v_member.photo_path
    ),
    'membership', jsonb_build_object(
      'plan', v_plan_name, 'end_date', coalesce(v_sub_end, v_member.membership_end_date),
      'access_restrictions', v_restrictions
    )
  );

  v_denial := case
    when v_member.archived_at is not null then 'Membre archivé'
    when v_sub_status = 'suspended' then 'Abonnement suspendu'
    when v_sub_end is null and v_member.membership_end_date is not null and v_member.membership_end_date < v_today
      then 'Abonnement expiré le ' || to_char(v_member.membership_end_date, 'DD/MM/YYYY')
    when v_sub_end is null and v_member.membership_end_date > v_today
      then 'L''abonnement n''a pas encore commencé'
    when v_sub_end is null then 'Aucun abonnement valide aujourd''hui'
  end;

  select st.checkin_debounce_minutes into v_debounce from public.organization_settings st where st.organization_id = p_org;
  select * into v_recent from public.attendance a
  where a.organization_id = p_org and a.member_id = p_member and a.status = 'valid'
    and a.checked_in_at > v_at - make_interval(mins => coalesce(v_debounce, 5))
    and a.checked_in_at < v_at + make_interval(mins => coalesce(v_debounce, 5))
  order by a.checked_in_at desc limit 1;
  if found then
    return v_payload || jsonb_build_object('result', 'duplicate', 'attendance_id', v_recent.id,
      'checked_in_at', v_recent.checked_in_at, 'message', 'Entrée déjà enregistrée il y a quelques minutes');
  end if;

  if v_replay then
    -- La personne est déjà entrée, sur la foi des données du poste : le passage réel
    -- est conservé. Un écart avec le serveur est tracé, jamais perdu.
    v_reason := case
      when v_denial is not null then 'Hors ligne : ' || v_denial
      else nullif(trim(p_override_reason), '')
    end;
  elsif v_denial is not null then
    if p_override_reason is null or length(trim(p_override_reason)) < 3 then
      return v_payload || jsonb_build_object('result', 'denied', 'message', v_denial,
        'can_override', private.has_permission(p_org, 'attendance.override') and v_member.archived_at is null);
    end if;
    perform private.require_permission(p_org, 'attendance.override');
    if v_member.archived_at is not null then raise exception 'Membre archivé : entrée impossible' using errcode = '22023'; end if;
    v_reason := trim(p_override_reason);
  end if;

  insert into public.attendance (id, organization_id, member_id, checked_in_at, method, override_reason, recorded_by)
  values (coalesce(v_row_id, gen_random_uuid()), p_org, p_member, v_at, p_method, v_reason, auth.uid())
  returning id into v_attendance_id;

  if v_denial is not null then
    perform private.write_audit(p_org, 'attendance.override', 'attendance', v_attendance_id::text,
      null, jsonb_build_object('member_id', p_member, 'denial', v_denial, 'offline', v_replay), v_reason);
  end if;

  return v_payload || jsonb_build_object('result', 'granted', 'attendance_id', v_attendance_id,
    'checked_in_at', v_at, 'overridden', v_denial is not null,
    'message', coalesce('Entrée forcée : ' || v_denial, 'Accès autorisé'));
end;
$$;

create or replace function public.check_out(p_org uuid, p_attendance uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission(p_org, 'attendance.write');
  update public.attendance
  set checked_out_at = coalesce(nullif(current_setting('app.sync_occurred_at', true), '')::timestamptz, now())
  where organization_id = p_org and id = p_attendance and checked_out_at is null and status = 'valid';
  if not found then raise exception 'Passage introuvable ou déjà clôturé' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Droits
-- -----------------------------------------------------------------------------
alter table public.sync_devices enable row level security;
alter table public.sync_ops enable row level security;
revoke all on public.sync_devices, public.sync_ops from anon, authenticated;
grant select on public.sync_devices, public.sync_ops to authenticated;

create policy sync_devices_select on public.sync_devices for select to authenticated
  using (private.is_staff_of(organization_id));
create policy sync_ops_select on public.sync_ops for select to authenticated
  using (private.is_staff_of(organization_id)
         and (user_id = auth.uid() or private.has_permission(organization_id, 'settings.manage')));

revoke execute on function
  private.sync_bump_version(), private.sync_log_change(), private.sync_prune(interval),
  private.sync_series_label(bigint), private.sync_device_series(uuid, uuid),
  private.sync_op_claim(uuid, uuid, uuid, text, jsonb, timestamptz),
  private.sync_op_finish(uuid, uuid, text, jsonb, jsonb, text, text),
  private.sync_subscription_id(uuid, jsonb), private.sync_payment_id(uuid, jsonb),
  private.sync_apply_row(uuid, text, jsonb), private.sync_dispatch(uuid, text, jsonb, timestamptz)
from public, anon;
revoke execute on function
  public.sync_changes(uuid, bigint, int), public.sync_register_device(uuid, uuid, text),
  public.sync_revoke_device(uuid, uuid), public.sync_apply_op(uuid, uuid, uuid, text, jsonb, timestamptz),
  public.sync_resolve_op(uuid, uuid)
from public, anon;

-- sync_apply_op s'exécute avec les droits de l'appelant pour que la RLS s'applique
-- aux modifications de lignes : il lui faut donc ses auxiliaires.
grant execute on function
  private.sync_bump_version(), private.sync_device_series(uuid, uuid),
  private.sync_op_claim(uuid, uuid, uuid, text, jsonb, timestamptz),
  private.sync_op_finish(uuid, uuid, text, jsonb, jsonb, text, text),
  private.sync_subscription_id(uuid, jsonb), private.sync_payment_id(uuid, jsonb),
  private.sync_apply_row(uuid, text, jsonb), private.sync_dispatch(uuid, text, jsonb, timestamptz)
to authenticated;
grant execute on function
  public.sync_changes(uuid, bigint, int), public.sync_register_device(uuid, uuid, text),
  public.sync_revoke_device(uuid, uuid), public.sync_apply_op(uuid, uuid, uuid, text, jsonb, timestamptz),
  public.sync_resolve_op(uuid, uuid)
to authenticated;

notify pgrst, 'reload schema';
