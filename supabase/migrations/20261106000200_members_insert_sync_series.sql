-- =============================================================================
-- Correctif : 20261106000100_checkin_pin a remplacé private.members_before_insert
-- par une version sans la règle des postes hors ligne (sync_foundation).
-- Cette version réunit les deux : code d'entrée à 4 chiffres ET numéro de membre
-- du poste conservé lors d'un rejeu de synchronisation (app.sync_*). Sur une base
-- sans synchronisation, ces réglages sont vides et le comportement est celui du web.
-- =============================================================================
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
  new.checkin_pin := coalesce(new.checkin_pin, private.new_checkin_pin(new.organization_id));
  new.registered_on := coalesce(new.registered_on, private.org_today(new.organization_id));
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;
