-- =============================================================================
-- Remise à zéro : supprime TOUTES les données d'exemple de « Salle Démo ».
-- IRRÉVERSIBLE. À exécuter UNE FOIS dans Supabase > SQL Editor, sur le projet
-- gym-crm (kxgghghnoaeecefgzkzz).
--
-- Conservé : le compte propriétaire et son accès, les paramètres de la salle,
-- les moyens de paiement, le schéma.
-- Supprimé : membres, coachs, prospects, formules, abonnements, paiements,
-- dépenses, présences, séances, équipements, notifications, journal d'audit.
-- Les compteurs repartent de zéro (M-000001, premier reçu...).
--
-- Tout est dans une seule transaction : en cas d'erreur, rien n'est modifié.
-- =============================================================================
begin;

-- Sécurité : s'arrête si ce n'est pas la base attendue.
do $$
begin
  if (select count(*) from public.organizations) <> 1
     or not exists (select 1 from public.organizations
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

alter table public.payments enable trigger payments_immutable;
alter table public.payment_adjustments enable trigger adjustments_immutable;

-- Vrai nom de la salle ; coordonnées fictives retirées (à saisir dans Paramètres).
update public.organizations
set name = 'Castle', slug = 'castle', address = null, phone = null, email = null, receipt_footer = null
where id = '757a8c68-0180-4648-a57b-80288b76a72b';

delete from private.counters where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';
-- En dernier : les suppressions et la mise à jour ci-dessus écrivent aussi dans l'audit.
delete from public.audit_logs where organization_id = '757a8c68-0180-4648-a57b-80288b76a72b';

commit;

-- Contrôle : tout doit être à 0, sauf staff = 1 et payment_methods = 4.
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
