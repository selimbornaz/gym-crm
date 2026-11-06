-- =============================================================================
-- Code d'entrée personnel à 4 chiffres
-- -----------------------------------------------------------------------------
-- Chaque membre reçoit un code aléatoire, unique dans sa salle, à donner à
-- l'accueil (ou à taper) à la place du QR code. Aléatoire et non séquentiel :
-- impossible d'entrer avec le code d'un autre en devinant la suite des numéros.
-- =============================================================================

alter type public.checkin_method add value if not exists 'pin';

alter table public.members
  add column checkin_pin text check (checkin_pin ~ '^[0-9]{4}$');

create unique index members_org_checkin_pin_key
  on public.members (organization_id, checkin_pin) where checkin_pin is not null;

/**
 * Tire un code libre pour la salle. Le verrou sérialise les attributions d'une
 * même salle : deux inscriptions simultanées ne peuvent pas obtenir le même code.
 */
create function private.new_checkin_pin(p_org uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_pin text;
begin
  perform pg_advisory_xact_lock(hashtext('checkin_pin:' || p_org::text));
  for i in 1 .. 500 loop
    v_pin := lpad(floor(random() * 10000)::int::text, 4, '0');
    if not exists (select 1 from public.members m where m.organization_id = p_org and m.checkin_pin = v_pin) then
      return v_pin;
    end if;
  end loop;
  raise exception 'Plus aucun code d''entrée disponible pour cette salle' using errcode = '23505';
end;
$$;

/** Attribue le code membre, le code d'entrée et la date d'inscription. */
create or replace function private.members_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prefix text;
begin
  select s.member_code_prefix into prefix from public.organization_settings s where s.organization_id = new.organization_id;
  new.member_code := coalesce(prefix, 'M') || '-' || lpad(private.next_counter(new.organization_id, 'member')::text, 6, '0');
  new.checkin_pin := coalesce(new.checkin_pin, private.new_checkin_pin(new.organization_id));
  new.registered_on := coalesce(new.registered_on, private.org_today(new.organization_id));
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end;
$$;

-- Membres existants : un code chacun (une ligne à la fois pour voir les codes déjà tirés).
do $$
declare
  r record;
begin
  for r in select id, organization_id from public.members where checkin_pin is null order by registered_on, id loop
    update public.members set checkin_pin = private.new_checkin_pin(r.organization_id) where id = r.id;
  end loop;
end;
$$;

/** Nouveau code (perdu ou communiqué à un tiers) ; l'ancien ne fonctionne plus. */
create function public.regenerate_checkin_pin(p_org uuid, p_member uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_pin text;
begin
  perform private.require_permission(p_org, 'members.write');
  v_pin := private.new_checkin_pin(p_org);
  update public.members set checkin_pin = v_pin where organization_id = p_org and id = p_member;
  if not found then raise exception 'Membre introuvable' using errcode = 'P0002'; end if;
  perform private.write_audit(p_org, 'member.checkin_pin_regenerated', 'member', p_member::text, null, null, null);
  return v_pin;
end;
$$;

revoke execute on function private.new_checkin_pin(uuid) from public, anon;
revoke execute on function public.regenerate_checkin_pin(uuid, uuid) from public, anon;
grant execute on function public.regenerate_checkin_pin(uuid, uuid) to authenticated;
