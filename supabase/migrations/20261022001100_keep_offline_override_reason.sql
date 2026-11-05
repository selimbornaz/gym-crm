-- =============================================================================
-- 0011 · Rejeu d'une entrée forcée hors ligne : le motif saisi est conservé dans
-- le passage et le journal d'audit, au lieu d'être remplacé par un motif générique.
-- =============================================================================
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
    -- Le motif saisi hors ligne (entrée forcée par le propriétaire) est conservé.
    v_reason := coalesce(
      nullif(trim(p_override_reason), ''),
      case when v_denial is not null then 'Hors ligne : ' || v_denial end
    );
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
