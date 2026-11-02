-- =============================================================================
-- Nettoyage FACULTATIF : supprime les données d'exemple de « Salle Démo », déjà
-- masquée dans l'application (la salle Castle n'est pas touchée).
-- IRRÉVERSIBLE. À exécuter UNE FOIS dans Supabase > SQL Editor, sur le projet
-- gym-crm (kxgghghnoaeecefgzkzz).
--
-- Conservé : le compte propriétaire, la ligne de la salle Démo, le schéma.
-- Supprimé : membres, coachs, prospects, formules, abonnements, paiements,
-- dépenses, présences, séances, équipements, notifications, journal d'audit.
--
-- Tout est dans une seule transaction : en cas d'erreur, rien n'est modifié.
-- =============================================================================
begin;

-- Sécurité : s'arrête si ce n'est pas la base attendue.
do $$
begin
  if not exists (select 1 from public.organizations
                    where id = '757a8c68-0180-4648-a57b-80288b76a72b' and slug = 'salle-demo') then
    raise exception 'Base inattendue : « Salle Démo » introuvable, aucune donnée modifiée';
  end if;
end $$;

-- Les paiements sont protégés contre la suppression : levée le temps du script.
alter table public.payments disable trigger payments_immutable;
alter table public.payment_adjustments disable trigger adjustments_immutable;

delete from public.payment_adjustments where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.payments            where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.subscription_events where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.subscriptions       where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.bookings            where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.sessions            where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.attendance          where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.workout_logs        where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.workout_exercises   where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.workout_days        where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.workout_programs    where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.progress_entries    where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.member_notes        where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.leads               where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.members             where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.coaches             where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.membership_plans    where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.expenses            where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.equipment_maintenance where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.equipment           where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.notifications       where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
delete from public.announcements       where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';

-- Journal de synchronisation (migration 0010) : ses triggers différés doivent
-- s'exécuter avant de pouvoir modifier les tables.
set constraints all immediate;

alter table public.payments enable trigger payments_immutable;
alter table public.payment_adjustments enable trigger adjustments_immutable;

-- Correctif de la migration 0009 : sans lui, modifier la salle échoue et annule
-- tout ce script (et la page Paramètres ne peut pas enregistrer).
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

delete from private.counters where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
-- En dernier : les suppressions ci-dessus écrivent aussi dans l'audit.
delete from public.audit_logs where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';

commit;

-- Contrôle : données à 0 tant que Castle est vide ; staff et payment_methods restent remplis.
select 'members' as table_name, count(*) from public.members
union all select 'coaches', count(*) from public.coaches
union all select 'leads', count(*) from public.leads
union all select 'membership_plans', count(*) from public.membership_plans
union all select 'subscriptions', count(*) from public.subscriptions
union all select 'payments', count(*) from public.payments
union all select 'expenses', count(*) from public.expenses
union all select 'attendance', count(*) from public.attendance
union all select 'sessions', count(*) from public.sessions
union all select 'equipment', count(*) from public.equipment
union all select 'notifications', count(*) from public.notifications
union all select 'audit_logs', count(*) from public.audit_logs
union all select 'staff', count(*) from public.staff
union all select 'payment_methods', count(*) from public.payment_methods;
