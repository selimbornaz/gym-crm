-- =============================================================================
-- 0008 · Montants dans les messages SQL au format de l'application :
-- « 50,000 DT » / « 1 250,500 DT » au lieu de « 50.000 TND ».
-- =============================================================================

/** 1250.5 -> '1 250,500 DT'. Format fixe, indépendant de la locale du serveur. */
create function private.fmt_dt(n numeric) returns text
language sql immutable set search_path = '' as $$
  select translate(to_char(n, 'FM999,999,999,990.000'), ',.', ' ,') || ' DT';
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
      raise exception 'Le montant dépasse le reste à payer (%)', private.fmt_dt(v_sub.total_due - v_sub.amount_paid)
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

create or replace function public.refund_payment(
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
    raise exception 'Montant invalide (max. % remboursables)', private.fmt_dt(v_remaining) using errcode = '22023';
  end if;

  -- Motif aussi transmis au journal d'audit (colonne « Motif »).
  perform set_config('app.audit_reason', trim(p_reason), true);

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

create or replace function public.refresh_notifications(p_org uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today date := private.org_today(p_org);
  v_alert int;
  r record;
  v_before int;
  v_after int;
begin
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
      'Solde impayé', r.name || ' — reste ' || private.fmt_dt(r.balance),
      '/members/' || r.member_id, 'unpaid:' || r.id || ':' || r.balance);
  end loop;

  for r in
    select s.id, s.title, s.starts_at, s.coach_id from public.sessions s
    where s.organization_id = p_org and s.status = 'scheduled'
      and s.starts_at between now() and now() + interval '24 hours'
  loop
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

-- Les messages déjà générés passent aussi au nouveau format.
update public.notifications
set body = regexp_replace(body, 'reste ([0-9]+)\.([0-9]{3}) TND$', 'reste \1,\2 DT')
where type = 'unpaid_balance' and body ~ 'reste [0-9]+\.[0-9]{3} TND$';

revoke execute on function private.fmt_dt(numeric) from public, anon;
