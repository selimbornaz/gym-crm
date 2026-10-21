-- =============================================================================
-- 0004 · Vues calculées et fonctions métier (RPC).
-- =============================================================================
-- Toutes les RPC :
--  * sont SECURITY DEFINER avec search_path vide (pas de détournement) ;
--  * vérifient la permission ET filtrent par `organization_id = p_org` ;
--  * sont idempotentes quand une double soumission est possible (request_id) ;
--  * verrouillent les lignes concernées (FOR UPDATE) pour la concurrence.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Utilitaires
-- -----------------------------------------------------------------------------

/** Date de fin d'une période : 1 mois à partir du 15/01 => 14/02 inclus. */
create function private.compute_end_date(p_start date, p_value int, p_unit public.duration_unit) returns date
language sql immutable as $$
  select case p_unit
    when 'day'   then p_start + p_value - 1
    when 'week'  then p_start + p_value * 7 - 1
    when 'month' then (p_start + make_interval(months => p_value))::date - 1
    when 'year'  then (p_start + make_interval(years => p_value))::date - 1
  end;
$$;

/** Statut d'adhésion lisible, calculé à partir de l'instantané du membre. */
create function private.membership_status(
  p_archived_at timestamptz, p_suspended boolean, p_end date, p_today date, p_alert_days int
) returns text
language sql immutable as $$
  select case
    when p_archived_at is not null then 'archived'
    when p_suspended then 'suspended'
    when p_end is null then 'none'
    when p_end < p_today then 'expired'
    when p_end <= p_today + p_alert_days then 'expiring'
    else 'active'
  end;
$$;

/** Utilisateurs actifs de la salle disposant d'une permission (destinataires). */
create function private.staff_with_permission(org uuid, perm text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.user_id
  from public.staff s
  join private.role_permissions rp on rp.role = s.role
  where s.organization_id = org and s.is_active and rp.permission = perm;
$$;

-- -----------------------------------------------------------------------------
-- Vues (security_invoker : la RLS des tables sous-jacentes s'applique)
-- -----------------------------------------------------------------------------
create view public.member_directory with (security_invoker = true) as
select
  m.*,
  m.first_name || ' ' || m.last_name as full_name,
  c.full_name as coach_name,
  private.membership_status(
    m.archived_at, m.membership_suspended, m.membership_end_date,
    private.org_today(m.organization_id), coalesce(st.expiry_alert_days, 7)
  ) as membership_status
from public.members m
left join public.coaches c on c.organization_id = m.organization_id and c.id = m.coach_id
left join public.organization_settings st on st.organization_id = m.organization_id;

create view public.subscription_overview with (security_invoker = true) as
select
  s.*,
  s.total_due - s.amount_paid as balance,
  case
    when s.amount_paid <= 0 and s.total_due > 0 then 'unpaid'
    when s.amount_paid < s.total_due then 'partial'
    else 'paid'
  end as payment_status,
  case
    when s.status = 'cancelled' then 'cancelled'
    when s.status = 'suspended' then 'suspended'
    when s.start_date > private.org_today(s.organization_id) then 'scheduled'
    when s.end_date < private.org_today(s.organization_id) then 'expired'
    else 'active'
  end as effective_status,
  m.member_code,
  m.first_name || ' ' || m.last_name as member_name,
  m.phone as member_phone
from public.subscriptions s
join public.members m on m.organization_id = s.organization_id and m.id = s.member_id;

create view public.payment_ledger with (security_invoker = true) as
select
  p.*,
  p.amount - p.refunded_amount as net_amount,
  pm.name as method_name,
  m.member_code,
  m.first_name || ' ' || m.last_name as member_name,
  s.plan_name
from public.payments p
join public.members m on m.organization_id = p.organization_id and m.id = p.member_id
join public.payment_methods pm on pm.organization_id = p.organization_id and pm.id = p.method_id
left join public.subscriptions s on s.organization_id = p.organization_id and s.id = p.subscription_id;

-- -----------------------------------------------------------------------------
-- Membres : détection de doublons
-- -----------------------------------------------------------------------------
create function public.find_member_duplicates(
  p_org uuid, p_first_name text, p_last_name text, p_phone text default null,
  p_email text default null, p_exclude uuid default null
) returns table (id uuid, member_code text, full_name text, phone text, email text, match_reason text)
language plpgsql stable security definer set search_path = '' as $$
declare
  digits text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  perform private.require_permission(p_org, 'members.write');
  return query
  select m.id, m.member_code, m.first_name || ' ' || m.last_name, m.phone, m.email,
    case
      when digits is not null and right(m.phone_digits, 8) = right(digits, 8) then 'Même téléphone'
      when p_email is not null and lower(m.email) = lower(trim(p_email)) then 'Même email'
      else 'Même nom'
    end
  from public.members m
  where m.organization_id = p_org
    and (p_exclude is null or m.id <> p_exclude)
    and (
      (digits is not null and length(digits) >= 8 and right(m.phone_digits, 8) = right(digits, 8))
      or (p_email is not null and length(trim(p_email)) > 3 and lower(m.email) = lower(trim(p_email)))
      or (lower(trim(m.first_name)) = lower(trim(p_first_name)) and lower(trim(m.last_name)) = lower(trim(p_last_name)))
    )
  limit 5;
end;
$$;

/** Journalise un export de données personnelles (qui, quand, combien, quels filtres). */
create function public.log_member_export(p_org uuid, p_count int, p_filters jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission(p_org, 'members.export');
  perform private.write_audit(p_org, 'members.export', 'members', null, null,
    jsonb_build_object('count', p_count, 'filters', p_filters));
end;
$$;

-- -----------------------------------------------------------------------------
-- Abonnements
-- -----------------------------------------------------------------------------

/**
 * Crée (ou renouvelle) un abonnement. Pour une adhésion, la date de début par
 * défaut est le lendemain de la fin de l'adhésion en cours (pas de jours perdus).
 * Idempotent sur `p_request_id`.
 */
create function public.create_subscription(
  p_org uuid, p_member uuid, p_plan uuid, p_request_id uuid,
  p_start date default null, p_discount numeric default 0, p_notes text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_existing uuid;
  v_plan public.membership_plans;
  v_member public.members;
  v_today date := private.org_today(p_org);
  v_start date;
  v_end date;
  v_has_previous boolean;
  v_id uuid;
begin
  perform private.require_permission(p_org, 'subscriptions.write');

  select s.id into v_existing from public.subscriptions s
  where s.organization_id = p_org and s.request_id = p_request_id;
  if found then return v_existing; end if;

  -- Verrou sur le membre : sérialise les créations concurrentes pour une même personne.
  select * into v_member from public.members m where m.organization_id = p_org and m.id = p_member for update;
  if not found then raise exception 'Membre introuvable' using errcode = 'P0002'; end if;
  if v_member.archived_at is not null then raise exception 'Ce membre est archivé' using errcode = '22023'; end if;

  select * into v_plan from public.membership_plans p where p.organization_id = p_org and p.id = p_plan;
  if not found or not v_plan.is_active then raise exception 'Formule introuvable ou inactive' using errcode = '22023'; end if;

  p_discount := round(coalesce(p_discount, 0), 3);
  if p_discount < 0 or p_discount > v_plan.price then
    raise exception 'Remise invalide (entre 0 et le prix de la formule)' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.subscriptions s
    where s.organization_id = p_org and s.member_id = p_member and s.kind = v_plan.kind and s.status <> 'cancelled'
  ) into v_has_previous;

  if p_start is not null then
    v_start := p_start;
  elsif v_plan.kind = 'membership' then
    select greatest(v_today, coalesce(max(s.end_date) + 1, v_today)) into v_start
    from public.subscriptions s
    where s.organization_id = p_org and s.member_id = p_member and s.kind = 'membership' and s.status <> 'cancelled';
  else
    v_start := v_today;
  end if;

  if v_start < v_today - 31 then
    raise exception 'La date de début ne peut pas remonter à plus de 31 jours' using errcode = '22023';
  end if;

  v_end := private.compute_end_date(v_start, v_plan.duration_value, v_plan.duration_unit);

  begin
    insert into public.subscriptions (
      organization_id, member_id, plan_id, plan_name, kind, start_date, end_date,
      price, discount, sessions_included, notes, request_id, created_by
    ) values (
      p_org, p_member, p_plan, v_plan.name, v_plan.kind, v_start, v_end,
      v_plan.price, p_discount, v_plan.sessions_included, nullif(trim(p_notes), ''), p_request_id, auth.uid()
    ) returning id into v_id;
  exception when exclusion_violation then
    raise exception 'Ce membre a déjà une adhésion sur cette période (renouvellement en double ?)' using errcode = '23P01';
  end;

  insert into public.subscription_events (organization_id, subscription_id, event_type, reason)
  values (p_org, v_id,
          (case when v_has_previous then 'renewed' else 'created' end)::public.subscription_event_type,
          nullif(trim(p_notes), ''));

  return v_id;
end;
$$;

/** Verrouille et renvoie un abonnement de la salle (erreur sinon). */
create function private.lock_subscription(p_org uuid, p_sub uuid) returns public.subscriptions
language plpgsql security definer set search_path = '' as $$
declare
  v public.subscriptions;
begin
  select * into v from public.subscriptions s where s.organization_id = p_org and s.id = p_sub for update;
  if not found then raise exception 'Abonnement introuvable' using errcode = 'P0002'; end if;
  return v;
end;
$$;

create function public.suspend_subscription(p_org uuid, p_sub uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.subscriptions;
  v_today date := private.org_today(p_org);
begin
  perform private.require_permission(p_org, 'subscriptions.manage');
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Motif obligatoire' using errcode = '22023'; end if;
  v := private.lock_subscription(p_org, p_sub);
  if v.status <> 'active' or v.end_date < v_today then
    raise exception 'Seul un abonnement en cours peut être suspendu' using errcode = '22023';
  end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.subscriptions set status = 'suspended', suspended_on = greatest(v_today, v.start_date)
  where organization_id = p_org and id = p_sub;
  insert into public.subscription_events (organization_id, subscription_id, event_type, reason)
  values (p_org, p_sub, 'suspended', p_reason);
end;
$$;

/** Réactive un abonnement suspendu et prolonge la fin du nombre de jours gelés. */
create function public.resume_subscription(p_org uuid, p_sub uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v public.subscriptions;
  v_days int;
begin
  perform private.require_permission(p_org, 'subscriptions.manage');
  v := private.lock_subscription(p_org, p_sub);
  if v.status <> 'suspended' then raise exception 'Cet abonnement n''est pas suspendu' using errcode = '22023'; end if;
  v_days := greatest(private.org_today(p_org) - v.suspended_on, 0);
  perform set_config('app.audit_reason', coalesce(p_reason, 'Reprise après suspension'), true);
  begin
    update public.subscriptions
    set status = 'active', suspended_on = null, end_date = end_date + v_days
    where organization_id = p_org and id = p_sub;
  exception when exclusion_violation then
    raise exception 'La prolongation chevauche un abonnement suivant : ajustez-le d''abord' using errcode = '23P01';
  end;
  insert into public.subscription_events (organization_id, subscription_id, event_type, days, reason)
  values (p_org, p_sub, 'resumed', v_days, p_reason);
  return v_days;
end;
$$;

create function public.cancel_subscription(p_org uuid, p_sub uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.subscriptions;
begin
  perform private.require_permission(p_org, 'subscriptions.manage');
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Motif obligatoire' using errcode = '22023'; end if;
  v := private.lock_subscription(p_org, p_sub);
  if v.status = 'cancelled' then raise exception 'Abonnement déjà annulé' using errcode = '22023'; end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.subscriptions
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, suspended_on = null
  where organization_id = p_org and id = p_sub;
  insert into public.subscription_events (organization_id, subscription_id, event_type, reason)
  values (p_org, p_sub, 'cancelled', p_reason);
end;
$$;

/** Prolongation manuelle (geste commercial, fermeture de la salle...) — tracée. */
create function public.extend_subscription(p_org uuid, p_sub uuid, p_days int, p_reason text) returns date
language plpgsql security definer set search_path = '' as $$
declare
  v public.subscriptions;
  v_end date;
begin
  perform private.require_permission(p_org, 'subscriptions.manage');
  if p_days is null or p_days not between 1 and 365 then raise exception 'Durée invalide (1 à 365 jours)' using errcode = '22023'; end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Motif obligatoire' using errcode = '22023'; end if;
  v := private.lock_subscription(p_org, p_sub);
  if v.status = 'cancelled' then raise exception 'Impossible de prolonger un abonnement annulé' using errcode = '22023'; end if;
  perform set_config('app.audit_reason', p_reason, true);
  begin
    update public.subscriptions set end_date = end_date + p_days
    where organization_id = p_org and id = p_sub
    returning end_date into v_end;
  exception when exclusion_violation then
    raise exception 'La prolongation chevauche un abonnement suivant' using errcode = '23P01';
  end;
  insert into public.subscription_events (organization_id, subscription_id, event_type, days, reason)
  values (p_org, p_sub, 'extended', p_days, p_reason);
  return v_end;
end;
$$;

-- -----------------------------------------------------------------------------
-- Paiements et remboursements
-- -----------------------------------------------------------------------------

/**
 * Enregistre un encaissement (total ou partiel). Refuse les trop-perçus.
 * Seuls les détenteurs de `reports.financial` peuvent antidater un paiement.
 */
create function public.record_payment(
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
  if v_paid_at < now() - interval '1 day' and not private.has_permission(p_org, 'reports.financial') then
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
      raise exception 'Le montant dépasse le reste à payer (% TND)', to_char(v_sub.total_due - v_sub.amount_paid, 'FM999999990.000')
        using errcode = '22023';
    end if;
  end if;

  select s.receipt_prefix into v_prefix from public.organization_settings s where s.organization_id = p_org;
  v_receipt := coalesce(v_prefix, 'R') || '-' || to_char(v_paid_at at time zone
      (select o.timezone from public.organizations o where o.id = p_org), 'YYYY') || '-'
    || lpad(private.next_counter(p_org, 'receipt')::text, 6, '0');

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

/**
 * Remboursement partiel (`refund`) ou annulation totale (`reversal`) d'un
 * paiement. Le paiement d'origine reste intact ; seul le montant remboursé évolue.
 */
create function public.refund_payment(
  p_org uuid, p_payment uuid, p_type public.adjustment_type, p_amount numeric,
  p_reason text, p_request_id uuid, p_method uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments;
  v_remaining numeric;
  v_id uuid;
begin
  perform private.require_permission(p_org, 'payments.refund');

  select a.id into v_id from public.payment_adjustments a where a.organization_id = p_org and a.request_id = p_request_id;
  if found then return v_id; end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Motif obligatoire' using errcode = '22023'; end if;

  select * into v_pay from public.payments p where p.organization_id = p_org and p.id = p_payment for update;
  if not found then raise exception 'Paiement introuvable' using errcode = 'P0002'; end if;

  v_remaining := v_pay.amount - v_pay.refunded_amount;
  if p_type = 'reversal' then p_amount := v_remaining; end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 3) or p_amount > v_remaining then
    raise exception 'Montant invalide (max. % TND remboursables)', to_char(v_remaining, 'FM999999990.000') using errcode = '22023';
  end if;

  insert into public.payment_adjustments (organization_id, payment_id, type, amount, reason, method_id, request_id)
  values (p_org, p_payment, p_type, p_amount, trim(p_reason), coalesce(p_method, v_pay.method_id), p_request_id)
  returning id into v_id;

  perform set_config('app.internal', 'on', true);
  update public.payments set refunded_amount = refunded_amount + p_amount where organization_id = p_org and id = p_payment;
  perform set_config('app.internal', 'off', true);

  if v_pay.subscription_id is not null then
    perform private.refresh_subscription_paid(p_org, v_pay.subscription_id);
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Présences
-- -----------------------------------------------------------------------------

/**
 * Contrôle d'accès à l'entrée. Les règles sont appliquées ICI (pas seulement
 * dans l'interface) : adhésion/pass valide aujourd'hui, non suspendu, non archivé.
 * Un propriétaire peut forcer l'entrée avec un motif (tracé).
 */
create function public.check_in(
  p_org uuid, p_member uuid, p_method public.checkin_method, p_override_reason text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_member public.members;
  v_today date := private.org_today(p_org);
  v_debounce int;
  v_plan_name text;
  v_sub_end date;
  v_sub_status public.subscription_status;
  v_restrictions text;
  v_recent public.attendance;
  v_denial text;
  v_attendance_id uuid;
  v_payload jsonb;
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
    and a.checked_in_at > now() - make_interval(mins => coalesce(v_debounce, 5))
  order by a.checked_in_at desc limit 1;
  if found then
    return v_payload || jsonb_build_object('result', 'duplicate', 'attendance_id', v_recent.id,
      'checked_in_at', v_recent.checked_in_at, 'message', 'Entrée déjà enregistrée il y a quelques minutes');
  end if;

  if v_denial is not null then
    if p_override_reason is null or length(trim(p_override_reason)) < 3 then
      return v_payload || jsonb_build_object('result', 'denied', 'message', v_denial,
        'can_override', private.has_permission(p_org, 'attendance.override') and v_member.archived_at is null);
    end if;
    perform private.require_permission(p_org, 'attendance.override');
    if v_member.archived_at is not null then raise exception 'Membre archivé : entrée impossible' using errcode = '22023'; end if;
  end if;

  insert into public.attendance (organization_id, member_id, method, override_reason, recorded_by)
  values (p_org, p_member, p_method, case when v_denial is not null then trim(p_override_reason) end, auth.uid())
  returning id into v_attendance_id;

  if v_denial is not null then
    perform private.write_audit(p_org, 'attendance.override', 'attendance', v_attendance_id::text,
      null, jsonb_build_object('member_id', p_member, 'denial', v_denial), trim(p_override_reason));
  end if;

  return v_payload || jsonb_build_object('result', 'granted', 'attendance_id', v_attendance_id,
    'checked_in_at', now(), 'overridden', v_denial is not null,
    'message', coalesce('Entrée forcée : ' || v_denial, 'Accès autorisé'));
end;
$$;

create function public.check_out(p_org uuid, p_attendance uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission(p_org, 'attendance.write');
  update public.attendance set checked_out_at = now()
  where organization_id = p_org and id = p_attendance and checked_out_at is null and status = 'valid';
  if not found then raise exception 'Passage introuvable ou déjà clôturé' using errcode = 'P0002'; end if;
end;
$$;

/** Correction manuelle d'un passage (heure, annulation) avec motif obligatoire. */
create function public.correct_attendance(
  p_org uuid, p_attendance uuid, p_reason text, p_void boolean default false,
  p_checked_in_at timestamptz default null, p_checked_out_at timestamptz default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_permission(p_org, 'attendance.correct');
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Motif obligatoire' using errcode = '22023'; end if;
  perform set_config('app.audit_reason', p_reason, true);
  update public.attendance set
    status = case when p_void then 'voided'::public.attendance_status else status end,
    checked_in_at = coalesce(p_checked_in_at, checked_in_at),
    checked_out_at = coalesce(p_checked_out_at, checked_out_at),
    correction_reason = trim(p_reason)
  where organization_id = p_org and id = p_attendance;
  if not found then raise exception 'Passage introuvable' using errcode = 'P0002'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Réservations
-- -----------------------------------------------------------------------------

/** Réserve une place ; refuse le surbooking (verrou sur la séance). */
create function public.book_session(p_org uuid, p_session uuid, p_member uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_member public.members;
  v_booked int;
  v_id uuid;
  v_my_coach uuid := private.my_coach_id(p_org);
begin
  select * into v_session from public.sessions s where s.organization_id = p_org and s.id = p_session for update;
  if not found then raise exception 'Séance introuvable' using errcode = 'P0002'; end if;

  select * into v_member from public.members m where m.organization_id = p_org and m.id = p_member;
  if not found then raise exception 'Membre introuvable' using errcode = 'P0002'; end if;

  -- Accueil/propriétaire : toutes les séances. Coach : ses séances, ses membres.
  if not private.has_permission(p_org, 'bookings.manage') then
    if not (private.has_permission(p_org, 'schedule.manage_own') and v_my_coach is not null
            and v_session.coach_id = v_my_coach and v_member.coach_id = v_my_coach) then
      raise exception 'Action non autorisée' using errcode = '42501';
    end if;
  end if;

  if v_session.status <> 'scheduled' then raise exception 'Séance annulée ou terminée' using errcode = '22023'; end if;
  if v_session.starts_at <= now() then raise exception 'La séance a déjà commencé' using errcode = '22023'; end if;
  if v_member.archived_at is not null then raise exception 'Membre archivé' using errcode = '22023'; end if;

  if exists (select 1 from public.bookings b where b.session_id = p_session and b.member_id = p_member and b.status = 'booked') then
    raise exception 'Ce membre est déjà inscrit' using errcode = '23505';
  end if;

  select count(*) into v_booked from public.bookings b where b.session_id = p_session and b.status = 'booked';
  if v_booked >= v_session.capacity then
    raise exception 'Séance complète (% / % places)', v_booked, v_session.capacity using errcode = '23514';
  end if;

  insert into public.bookings (organization_id, session_id, member_id, status)
  values (p_org, p_session, p_member, 'booked')
  on conflict (session_id, member_id) do update set status = 'booked', cancelled_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create function public.cancel_booking(p_org uuid, p_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_coach uuid;
begin
  select s.coach_id into v_coach from public.bookings b
  join public.sessions s on s.organization_id = b.organization_id and s.id = b.session_id
  where b.organization_id = p_org and b.id = p_booking;
  if not found then raise exception 'Réservation introuvable' using errcode = 'P0002'; end if;
  if not private.has_permission(p_org, 'bookings.manage')
     and not (private.has_permission(p_org, 'schedule.manage_own') and v_coach = private.my_coach_id(p_org)) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  update public.bookings set status = 'cancelled', cancelled_at = now()
  where organization_id = p_org and id = p_booking and status = 'booked';
end;
$$;

-- -----------------------------------------------------------------------------
-- Prospects -> membres
-- -----------------------------------------------------------------------------
create function public.convert_lead(p_org uuid, p_lead uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_member uuid;
begin
  perform private.require_permission(p_org, 'members.write');
  select * into v_lead from public.leads l where l.organization_id = p_org and l.id = p_lead for update;
  if not found then raise exception 'Prospect introuvable' using errcode = 'P0002'; end if;
  if v_lead.converted_member_id is not null then return v_lead.converted_member_id; end if;

  insert into public.members (organization_id, first_name, last_name, phone, email, coach_id, registered_on)
  values (p_org, v_lead.first_name, v_lead.last_name, v_lead.phone, v_lead.email, v_lead.coach_id, private.org_today(p_org))
  returning id into v_member;

  update public.leads set status = 'won', converted_member_id = v_member, last_activity_at = now()
  where organization_id = p_org and id = p_lead;
  return v_member;
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
create function private.notify(
  org uuid, perm text, p_type text, p_title text, p_body text, p_link text, p_key text
) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.notifications (organization_id, recipient_user_id, type, title, body, link, dedupe_key)
  select org, u, p_type, p_title, p_body, p_link, p_key
  from private.staff_with_permission(org, perm) u
  where exists (select 1 from public.organization_settings st where st.organization_id = org and p_type = any (st.notify_types))
  on conflict (organization_id, recipient_user_id, dedupe_key) do nothing;
$$;

/**
 * Génère les alertes du jour (idempotent grâce à `dedupe_key`). Appelée à
 * l'ouverture du tableau de bord et par la tâche planifiée quotidienne.
 */
create function public.refresh_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.org_today(p_org);
  v_alert int;
  r record;
  v_before int;
  v_after int;
begin
  -- Autorisé pour le personnel de la salle, ou le service_role (tâche planifiée).
  if auth.uid() is not null and not private.is_staff_of(p_org) then
    raise exception 'Action non autorisée' using errcode = '42501';
  end if;
  select count(*) into v_before from public.notifications where organization_id = p_org;
  select st.expiry_alert_days into v_alert from public.organization_settings st where st.organization_id = p_org;

  for r in
    select m.id, m.first_name || ' ' || m.last_name as name, m.membership_end_date as end_date
    from public.members m
    where m.organization_id = p_org and m.archived_at is null and not m.membership_suspended
      and m.membership_end_date between v_today and v_today + coalesce(v_alert, 7)
  loop
    perform private.notify(p_org, 'subscriptions.read', 'membership_expiring',
      'Abonnement bientôt expiré', r.name || ' — fin le ' || to_char(r.end_date, 'DD/MM/YYYY'),
      '/members/' || r.id, 'expiring:' || r.id || ':' || r.end_date);
  end loop;

  for r in
    select m.id, m.first_name || ' ' || m.last_name as name, m.membership_end_date as end_date
    from public.members m
    where m.organization_id = p_org and m.archived_at is null
      and m.membership_end_date between v_today - 3 and v_today - 1
  loop
    perform private.notify(p_org, 'subscriptions.read', 'membership_expired',
      'Abonnement expiré', r.name || ' — expiré le ' || to_char(r.end_date, 'DD/MM/YYYY'),
      '/members/' || r.id, 'expired:' || r.id || ':' || r.end_date);
  end loop;

  for r in
    select s.id, s.member_id, m.first_name || ' ' || m.last_name as name, s.total_due - s.amount_paid as balance
    from public.subscriptions s
    join public.members m on m.organization_id = s.organization_id and m.id = s.member_id
    where s.organization_id = p_org and s.status <> 'cancelled' and s.start_date <= v_today
      and s.total_due > s.amount_paid
  loop
    perform private.notify(p_org, 'payments.read', 'unpaid_balance',
      'Solde impayé', r.name || ' — reste ' || to_char(r.balance, 'FM999999990.000') || ' TND',
      '/members/' || r.member_id, 'unpaid:' || r.id || ':' || r.balance);
  end loop;

  for r in
    select s.id, s.title, s.starts_at, s.coach_id from public.sessions s
    where s.organization_id = p_org and s.status = 'scheduled'
      and s.starts_at between now() and now() + interval '24 hours'
  loop
    -- Coach concerné + personnel qui gère le planning.
    insert into public.notifications (organization_id, recipient_user_id, type, title, body, link, dedupe_key)
    select p_org, u, 'upcoming_session', 'Séance à venir',
      r.title || ' — ' || to_char(r.starts_at at time zone 'Africa/Tunis', 'DD/MM HH24:MI'),
      '/schedule', 'session:' || r.id
    from (
      select st.user_id as u from public.coaches c join public.staff st on st.id = c.staff_id
      where c.organization_id = p_org and c.id = r.coach_id and st.is_active
      union select * from private.staff_with_permission(p_org, 'schedule.manage')
    ) recipients
    where exists (select 1 from public.organization_settings st
                  where st.organization_id = p_org and 'upcoming_session' = any (st.notify_types))
    on conflict do nothing;
  end loop;

  for r in
    select e.id, e.name, e.next_maintenance_on from public.equipment e
    where e.organization_id = p_org and e.archived_at is null and e.next_maintenance_on <= v_today + 7
  loop
    perform private.notify(p_org, 'equipment.manage', 'equipment_maintenance',
      'Maintenance à prévoir', r.name || ' — échéance ' || to_char(r.next_maintenance_on, 'DD/MM/YYYY'),
      '/equipment', 'equip:' || r.id || ':' || r.next_maintenance_on);
  end loop;

  select count(*) into v_after from public.notifications where organization_id = p_org;
  return v_after - v_before;
end;
$$;

create function private.members_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.organization_id, 'staff.manage', 'new_member', 'Nouveau membre',
    new.first_name || ' ' || new.last_name || ' (' || new.member_code || ')',
    '/members/' || new.id, 'new_member:' || new.id);
  return new;
end;
$$;
create trigger members_after_insert after insert on public.members
  for each row execute function private.members_after_insert();

create function private.announcements_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.organization_id, 'notifications.read', 'announcement', new.title, new.body,
    '/notifications', 'announcement:' || new.id);
  return new;
end;
$$;
create trigger announcements_after_insert after insert on public.announcements
  for each row execute function private.announcements_after_insert();

-- -----------------------------------------------------------------------------
-- Tableau de bord et rapports financiers
-- -----------------------------------------------------------------------------

/** Encaissements nets par jour local (paiements - remboursements à leur date). */
create function private.net_revenue_between(p_org uuid, p_from date, p_to date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select sum(p.amount) from public.payments p
    where p.organization_id = p_org
      and (p.paid_at at time zone o.timezone)::date between p_from and p_to
  ), 0) - coalesce((
    select sum(a.amount) from public.payment_adjustments a
    where a.organization_id = p_org
      and (a.created_at at time zone o.timezone)::date between p_from and p_to
  ), 0)
  from public.organizations o where o.id = p_org;
$$;

create function public.dashboard_stats(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.org_today(p_org);
  v_alert int;
  v_tz text;
  v_financial boolean := private.has_permission(p_org, 'dashboard.financial');
  v_result jsonb;
begin
  perform private.require_permission(p_org, 'dashboard.view');
  select st.expiry_alert_days, o.timezone into v_alert, v_tz
  from public.organizations o join public.organization_settings st on st.organization_id = o.id where o.id = p_org;

  select jsonb_build_object(
    'today', v_today,
    'members_total', count(*) filter (where m.archived_at is null),
    'members_active', count(*) filter (where m.archived_at is null and not m.membership_suspended and m.membership_end_date >= v_today),
    'members_expired', count(*) filter (where m.archived_at is null and m.membership_end_date < v_today),
    'members_expiring', count(*) filter (where m.archived_at is null and not m.membership_suspended
                                          and m.membership_end_date between v_today and v_today + 7),
    'members_suspended', count(*) filter (where m.archived_at is null and m.membership_suspended),
    'new_members_month', count(*) filter (where m.registered_on >= date_trunc('month', v_today)::date),
    'checkins_today', (select count(*) from public.attendance a where a.organization_id = p_org and a.status = 'valid'
                         and (a.checked_in_at at time zone v_tz)::date = v_today),
    'present_now', (select count(*) from public.attendance a where a.organization_id = p_org and a.status = 'valid'
                      and a.checked_out_at is null and (a.checked_in_at at time zone v_tz)::date = v_today)
  ) into v_result
  from public.members m where m.organization_id = p_org;

  -- Croissance : nouveaux membres et membres actifs en fin de mois (12 mois).
  v_result := v_result || jsonb_build_object('growth', (
    select jsonb_agg(jsonb_build_object(
      'month', to_char(mo, 'YYYY-MM'),
      'new_members', (select count(*) from public.members m where m.organization_id = p_org
                        and m.registered_on >= mo and m.registered_on < mo + interval '1 month'),
      'active_members', (select count(distinct s.member_id) from public.subscriptions s
                           where s.organization_id = p_org and s.status <> 'cancelled' and s.kind in ('membership', 'pass')
                             and s.start_date <= least((mo + interval '1 month')::date - 1, v_today)
                             and s.end_date >= least((mo + interval '1 month')::date - 1, v_today))
    ) order by mo)
    from generate_series(date_trunc('month', v_today) - interval '11 months', date_trunc('month', v_today), interval '1 month') mo
  ));

  v_result := v_result || jsonb_build_object('recent_checkins', coalesce((
    select jsonb_agg(x order by x ->> 'at' desc) from (
      select jsonb_build_object('id', a.id, 'member_id', m.id, 'name', m.first_name || ' ' || m.last_name,
                                'code', m.member_code, 'at', a.checked_in_at, 'overridden', a.override_reason is not null) x
      from public.attendance a join public.members m on m.organization_id = a.organization_id and m.id = a.member_id
      where a.organization_id = p_org and a.status = 'valid'
      order by a.checked_in_at desc limit 8
    ) t
  ), '[]'::jsonb));

  if v_financial then
    v_result := v_result || jsonb_build_object(
      'revenue_today', private.net_revenue_between(p_org, v_today, v_today),
      'revenue_month', private.net_revenue_between(p_org, date_trunc('month', v_today)::date, v_today),
      'revenue_year', private.net_revenue_between(p_org, date_trunc('year', v_today)::date, v_today),
      'unpaid_total', (select coalesce(sum(s.total_due - s.amount_paid), 0) from public.subscriptions s
                         where s.organization_id = p_org and s.status <> 'cancelled' and s.total_due > s.amount_paid),
      'unpaid_count', (select count(*) from public.subscriptions s
                         where s.organization_id = p_org and s.status <> 'cancelled' and s.total_due > s.amount_paid),
      'revenue_trend', (
        select jsonb_agg(jsonb_build_object(
          'month', to_char(mo, 'YYYY-MM'),
          'net', private.net_revenue_between(p_org, mo::date, least((mo + interval '1 month')::date - 1, v_today))
        ) order by mo)
        from generate_series(date_trunc('month', v_today) - interval '11 months', date_trunc('month', v_today), interval '1 month') mo
      ),
      'recent_payments', coalesce((
        select jsonb_agg(x) from (
          select jsonb_build_object('id', p.id, 'member_id', m.id, 'name', m.first_name || ' ' || m.last_name,
                                    'amount', p.amount, 'refunded', p.refunded_amount, 'receipt', p.receipt_number, 'at', p.paid_at) x
          from public.payments p join public.members m on m.organization_id = p.organization_id and m.id = p.member_id
          where p.organization_id = p_org order by p.paid_at desc limit 8
        ) t
      ), '[]'::jsonb)
    );
  end if;

  return v_result;
end;
$$;

/** Encaissements par période (jour, semaine, mois, année) entre deux dates. */
create function public.revenue_report(p_org uuid, p_from date, p_to date, p_granularity text default 'day')
returns table (period date, gross numeric, refunds numeric, net numeric, payments_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
begin
  perform private.require_permission(p_org, 'reports.financial');
  if p_granularity not in ('day', 'week', 'month', 'year') then raise exception 'Granularité invalide' using errcode = '22023'; end if;
  if p_to < p_from or p_to - p_from > 3660 then raise exception 'Période invalide' using errcode = '22023'; end if;
  select o.timezone into v_tz from public.organizations o where o.id = p_org;

  return query
  with pay as (
    select date_trunc(p_granularity, (p.paid_at at time zone v_tz)::date)::date as k, sum(p.amount) as amt, count(*) as n
    from public.payments p
    where p.organization_id = p_org and (p.paid_at at time zone v_tz)::date between p_from and p_to
    group by 1
  ), adj as (
    select date_trunc(p_granularity, (a.created_at at time zone v_tz)::date)::date as k, sum(a.amount) as amt
    from public.payment_adjustments a
    where a.organization_id = p_org and (a.created_at at time zone v_tz)::date between p_from and p_to
    group by 1
  )
  select coalesce(pay.k, adj.k), coalesce(pay.amt, 0), coalesce(adj.amt, 0),
         coalesce(pay.amt, 0) - coalesce(adj.amt, 0), coalesce(pay.n, 0)
  from pay full join adj on adj.k = pay.k
  order by 1;
end;
$$;

/** Encaissements nets ventilés par formule. */
create function public.revenue_by_plan(p_org uuid, p_from date, p_to date)
returns table (plan_name text, net numeric, payments_count bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
begin
  perform private.require_permission(p_org, 'reports.financial');
  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  return query
  select coalesce(s.plan_name, 'Hors abonnement'), sum(p.amount - p.refunded_amount), count(*)
  from public.payments p
  left join public.subscriptions s on s.organization_id = p.organization_id and s.id = p.subscription_id
  where p.organization_id = p_org and (p.paid_at at time zone v_tz)::date between p_from and p_to
  group by 1 order by 2 desc;
end;
$$;

/** Compte de résultat simplifié (encaissements - remboursements - dépenses). */
create function public.profit_and_loss(p_org uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text;
  v_gross numeric;
  v_refunds numeric;
  v_expenses numeric;
begin
  perform private.require_permission(p_org, 'reports.financial');
  select o.timezone into v_tz from public.organizations o where o.id = p_org;
  select coalesce(sum(p.amount), 0) into v_gross from public.payments p
  where p.organization_id = p_org and (p.paid_at at time zone v_tz)::date between p_from and p_to;
  select coalesce(sum(a.amount), 0) into v_refunds from public.payment_adjustments a
  where a.organization_id = p_org and (a.created_at at time zone v_tz)::date between p_from and p_to;
  select coalesce(sum(e.amount), 0) into v_expenses from public.expenses e
  where e.organization_id = p_org and e.voided_at is null and e.spent_on between p_from and p_to;

  return jsonb_build_object(
    'gross', v_gross, 'refunds', v_refunds, 'net_revenue', v_gross - v_refunds,
    'expenses', v_expenses, 'result', v_gross - v_refunds - v_expenses,
    'expenses_by_category', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'amount', total) order by total desc)
      from (select e.category, sum(e.amount) as total from public.expenses e
            where e.organization_id = p_org and e.voided_at is null and e.spent_on between p_from and p_to
            group by e.category) c
    ), '[]'::jsonb)
  );
end;
$$;
