-- =============================================================================
-- 0009 · Correctif : la table organizations n'a pas de colonne organization_id
-- (son identifiant de salle est `id`). Le trigger d'audit écrivait donc NULL et
-- toute modification de la salle échouait, y compris depuis Paramètres.
-- =============================================================================
create or replace function private.audit_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  perform private.write_audit(
    (case when tg_table_name = 'organizations' then rec ->> 'id' else rec ->> 'organization_id' end)::uuid,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    rec ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;
