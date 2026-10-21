-- =============================================================================
-- 0005 · Row Level Security, privilèges minimaux, stockage.
-- =============================================================================
-- Règle d'or : AUCUNE politique ne donne accès à une ligne d'une autre salle.
-- Chaque prédicat passe par private.has_permission(organization_id, ...), qui
-- n'est vrai que pour le personnel ACTIF de CETTE salle.
-- Les écritures sensibles (abonnements, paiements, remboursements, présences,
-- réservations) n'ont AUCUNE politique d'écriture directe : elles passent par
-- les RPC de la migration 0004 qui appliquent les règles métier.
-- =============================================================================

-- Helpers spécifiques aux coachs ---------------------------------------------
create function private.member_is_mine(org uuid, p_member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.organization_id = org and m.id = p_member
      and m.coach_id is not null and m.coach_id = private.my_coach_id(org)
  );
$$;

create function private.can_edit_program(org uuid, p_program uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.has_permission(org, 'workouts.manage_all')
    or (private.has_permission(org, 'workouts.manage_assigned') and exists (
      select 1 from public.workout_programs p
      where p.organization_id = org and p.id = p_program
        and (private.member_is_mine(org, p.member_id)
             or (p.member_id is null and p.coach_id = private.my_coach_id(org)))
    ));
$$;

create function private.can_edit_day(org uuid, p_day uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workout_days d
    where d.organization_id = org and d.id = p_day and private.can_edit_program(org, d.program_id)
  );
$$;

create function private.shares_org_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff me join public.staff other on other.organization_id = me.organization_id
    where me.user_id = auth.uid() and me.is_active and other.user_id = p_user
  );
$$;

create function private.try_uuid(p text) returns uuid
language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function private.member_is_mine(uuid, uuid), private.can_edit_program(uuid, uuid),
  private.can_edit_day(uuid, uuid), private.shares_org_with(uuid), private.try_uuid(text),
  private.my_coach_id(uuid) to authenticated;

-- Activation de la RLS sur toutes les tables exposées --------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    -- Pas de FORCE : les fonctions SECURITY DEFINER (propriétaire) doivent
    -- pouvoir appliquer les règles métier ; elles filtrent elles-mêmes par salle.
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Le rôle anonyme n'a accès à rien.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Écritures directes interdites sur les tables pilotées par RPC / triggers.
revoke insert, update, delete on public.subscriptions, public.subscription_events, public.payments,
  public.payment_adjustments, public.audit_logs, public.attendance, public.notifications
  from authenticated;
grant update (read_at) on public.notifications to authenticated;
revoke delete on public.members, public.staff, public.organizations, public.organization_settings,
  public.expenses, public.membership_plans, public.payment_methods, public.coaches, public.sessions
  from authenticated;
revoke insert on public.organizations, public.organization_settings, public.staff from authenticated;

-- -----------------------------------------------------------------------------
-- Organisation, paramètres, profils, personnel, audit
-- -----------------------------------------------------------------------------
create policy org_select on public.organizations for select to authenticated
  using (private.is_staff_of(id));
create policy org_update on public.organizations for update to authenticated
  using (private.has_permission(id, 'settings.manage')) with check (private.has_permission(id, 'settings.manage'));

create policy settings_select on public.organization_settings for select to authenticated
  using (private.is_staff_of(organization_id));
create policy settings_update on public.organization_settings for update to authenticated
  using (private.has_permission(organization_id, 'settings.manage'))
  with check (private.has_permission(organization_id, 'settings.manage'));

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.shares_org_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy staff_select on public.staff for select to authenticated
  using (private.is_staff_of(organization_id));
create policy staff_update on public.staff for update to authenticated
  using (private.has_permission(organization_id, 'staff.manage'))
  with check (private.has_permission(organization_id, 'staff.manage'));

create policy audit_select on public.audit_logs for select to authenticated
  using (private.has_permission(organization_id, 'audit.read'));

-- -----------------------------------------------------------------------------
-- Coachs, membres, notes, prospects
-- -----------------------------------------------------------------------------
create policy coaches_select on public.coaches for select to authenticated
  using (private.has_permission(organization_id, 'coaches.read'));
create policy coaches_insert on public.coaches for insert to authenticated
  with check (private.has_permission(organization_id, 'coaches.manage'));
create policy coaches_update on public.coaches for update to authenticated
  using (private.has_permission(organization_id, 'coaches.manage'))
  with check (private.has_permission(organization_id, 'coaches.manage'));

create policy members_select on public.members for select to authenticated
  using (
    private.has_permission(organization_id, 'members.read_all')
    or (private.has_permission(organization_id, 'members.read_assigned')
        and coach_id is not null and coach_id = private.my_coach_id(organization_id))
  );
create policy members_insert on public.members for insert to authenticated
  with check (private.has_permission(organization_id, 'members.write'));
create policy members_update on public.members for update to authenticated
  using (private.has_permission(organization_id, 'members.write'))
  with check (private.has_permission(organization_id, 'members.write'));

create policy member_notes_select on public.member_notes for select to authenticated
  using (private.has_permission(organization_id, 'member_notes.manage'));
create policy member_notes_insert on public.member_notes for insert to authenticated
  with check (private.has_permission(organization_id, 'member_notes.manage') and created_by = auth.uid());
create policy member_notes_delete on public.member_notes for delete to authenticated
  using (private.has_permission(organization_id, 'member_notes.manage') and created_by = auth.uid());

create policy leads_all on public.leads for all to authenticated
  using (private.has_permission(organization_id, 'leads.manage'))
  with check (private.has_permission(organization_id, 'leads.manage'));

-- -----------------------------------------------------------------------------
-- Formules, abonnements, paiements, dépenses
-- -----------------------------------------------------------------------------
create policy plans_select on public.membership_plans for select to authenticated
  using (private.has_permission(organization_id, 'plans.read'));
create policy plans_insert on public.membership_plans for insert to authenticated
  with check (private.has_permission(organization_id, 'plans.manage'));
create policy plans_update on public.membership_plans for update to authenticated
  using (private.has_permission(organization_id, 'plans.manage'))
  with check (private.has_permission(organization_id, 'plans.manage'));

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (private.has_permission(organization_id, 'subscriptions.read'));
create policy subscription_events_select on public.subscription_events for select to authenticated
  using (private.has_permission(organization_id, 'subscriptions.read'));

create policy payment_methods_select on public.payment_methods for select to authenticated
  using (private.has_permission(organization_id, 'payments.read')
         or private.has_permission(organization_id, 'expenses.manage'));
create policy payment_methods_insert on public.payment_methods for insert to authenticated
  with check (private.has_permission(organization_id, 'payment_methods.manage'));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (private.has_permission(organization_id, 'payment_methods.manage'))
  with check (private.has_permission(organization_id, 'payment_methods.manage'));

create policy payments_select on public.payments for select to authenticated
  using (private.has_permission(organization_id, 'payments.read'));
create policy adjustments_select on public.payment_adjustments for select to authenticated
  using (private.has_permission(organization_id, 'payments.read'));

create policy expenses_select on public.expenses for select to authenticated
  using (private.has_permission(organization_id, 'expenses.manage'));
create policy expenses_insert on public.expenses for insert to authenticated
  with check (private.has_permission(organization_id, 'expenses.manage'));
create policy expenses_update on public.expenses for update to authenticated
  using (private.has_permission(organization_id, 'expenses.manage'))
  with check (private.has_permission(organization_id, 'expenses.manage'));

-- -----------------------------------------------------------------------------
-- Présences
-- -----------------------------------------------------------------------------
create policy attendance_select on public.attendance for select to authenticated
  using (
    private.has_permission(organization_id, 'attendance.read')
    or (private.has_permission(organization_id, 'attendance.read_assigned')
        and private.member_is_mine(organization_id, member_id))
  );

-- -----------------------------------------------------------------------------
-- Entraînement et progression
-- -----------------------------------------------------------------------------
create policy programs_select on public.workout_programs for select to authenticated
  using (
    private.has_permission(organization_id, 'workouts.manage_all')
    or private.has_permission(organization_id, 'members.read_all')
    or (private.has_permission(organization_id, 'workouts.manage_assigned')
        and (private.member_is_mine(organization_id, member_id)
             or (member_id is null and coach_id = private.my_coach_id(organization_id))))
  );
create policy programs_insert on public.workout_programs for insert to authenticated
  with check (
    private.has_permission(organization_id, 'workouts.manage_all')
    or (private.has_permission(organization_id, 'workouts.manage_assigned')
        and coach_id = private.my_coach_id(organization_id)
        and (member_id is null or private.member_is_mine(organization_id, member_id)))
  );
create policy programs_update on public.workout_programs for update to authenticated
  using (private.can_edit_program(organization_id, id))
  with check (
    private.has_permission(organization_id, 'workouts.manage_all')
    or (member_id is null or private.member_is_mine(organization_id, member_id))
  );
create policy programs_delete on public.workout_programs for delete to authenticated
  using (private.can_edit_program(organization_id, id));

create policy days_select on public.workout_days for select to authenticated
  using (exists (select 1 from public.workout_programs p where p.organization_id = workout_days.organization_id and p.id = program_id));
create policy days_write on public.workout_days for all to authenticated
  using (private.can_edit_program(organization_id, program_id))
  with check (private.can_edit_program(organization_id, program_id));

create policy exercises_select on public.workout_exercises for select to authenticated
  using (exists (select 1 from public.workout_days d where d.organization_id = workout_exercises.organization_id and d.id = day_id));
create policy exercises_write on public.workout_exercises for all to authenticated
  using (private.can_edit_day(organization_id, day_id))
  with check (private.can_edit_day(organization_id, day_id));

create policy logs_select on public.workout_logs for select to authenticated
  using (exists (select 1 from public.workout_programs p where p.organization_id = workout_logs.organization_id and p.id = program_id));
create policy logs_insert on public.workout_logs for insert to authenticated
  with check (private.can_edit_program(organization_id, program_id));
create policy logs_delete on public.workout_logs for delete to authenticated
  using (private.can_edit_program(organization_id, program_id));

create policy progress_select on public.progress_entries for select to authenticated
  using (
    private.has_permission(organization_id, 'progress.manage_all')
    or (private.has_permission(organization_id, 'progress.manage_assigned') and private.member_is_mine(organization_id, member_id))
  );
create policy progress_insert on public.progress_entries for insert to authenticated
  with check (
    private.has_permission(organization_id, 'progress.manage_all')
    or (private.has_permission(organization_id, 'progress.manage_assigned') and private.member_is_mine(organization_id, member_id))
  );
create policy progress_delete on public.progress_entries for delete to authenticated
  using (
    private.has_permission(organization_id, 'progress.manage_all')
    or (private.has_permission(organization_id, 'progress.manage_assigned') and recorded_by = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- Planning et réservations
-- -----------------------------------------------------------------------------
create policy sessions_select on public.sessions for select to authenticated
  using (private.has_permission(organization_id, 'schedule.read'));
create policy sessions_insert on public.sessions for insert to authenticated
  with check (
    private.has_permission(organization_id, 'schedule.manage')
    or (private.has_permission(organization_id, 'schedule.manage_own') and coach_id = private.my_coach_id(organization_id))
  );
create policy sessions_update on public.sessions for update to authenticated
  using (
    private.has_permission(organization_id, 'schedule.manage')
    or (private.has_permission(organization_id, 'schedule.manage_own') and coach_id = private.my_coach_id(organization_id))
  )
  with check (
    private.has_permission(organization_id, 'schedule.manage')
    or (private.has_permission(organization_id, 'schedule.manage_own') and coach_id = private.my_coach_id(organization_id))
  );

create policy bookings_select on public.bookings for select to authenticated
  using (
    private.has_permission(organization_id, 'bookings.manage')
    or exists (select 1 from public.sessions s where s.organization_id = bookings.organization_id and s.id = session_id
               and s.coach_id = private.my_coach_id(bookings.organization_id))
  );
revoke insert, delete on public.bookings from authenticated;
create policy bookings_update on public.bookings for update to authenticated
  using (
    private.has_permission(organization_id, 'bookings.manage')
    or exists (select 1 from public.sessions s where s.organization_id = bookings.organization_id and s.id = session_id
               and s.coach_id = private.my_coach_id(bookings.organization_id))
  );

-- -----------------------------------------------------------------------------
-- Équipements, notifications, annonces
-- -----------------------------------------------------------------------------
create policy equipment_select on public.equipment for select to authenticated
  using (private.has_permission(organization_id, 'equipment.read'));
create policy equipment_insert on public.equipment for insert to authenticated
  with check (private.has_permission(organization_id, 'equipment.manage'));
create policy equipment_update on public.equipment for update to authenticated
  using (private.has_permission(organization_id, 'equipment.manage'))
  with check (private.has_permission(organization_id, 'equipment.manage'));

create policy maintenance_select on public.equipment_maintenance for select to authenticated
  using (private.has_permission(organization_id, 'equipment.read'));
create policy maintenance_insert on public.equipment_maintenance for insert to authenticated
  with check (private.has_permission(organization_id, 'equipment.manage'));

create policy notifications_select on public.notifications for select to authenticated
  using (recipient_user_id = auth.uid() and private.is_staff_of(organization_id));
create policy notifications_update on public.notifications for update to authenticated
  using (recipient_user_id = auth.uid() and private.is_staff_of(organization_id))
  with check (recipient_user_id = auth.uid());

create policy announcements_select on public.announcements for select to authenticated
  using (private.has_permission(organization_id, 'notifications.read'));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (private.has_permission(organization_id, 'announcements.manage') and created_by = auth.uid());

-- -----------------------------------------------------------------------------
-- Fonctions : personne n'exécute rien par défaut, puis ouverture ciblée
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
revoke execute on all functions in schema private from public, anon;

grant execute on function
  public.my_permissions(uuid),
  public.find_member_duplicates(uuid, text, text, text, text, uuid),
  public.log_member_export(uuid, int, jsonb),
  public.create_subscription(uuid, uuid, uuid, uuid, date, numeric, text),
  public.suspend_subscription(uuid, uuid, text),
  public.resume_subscription(uuid, uuid, text),
  public.cancel_subscription(uuid, uuid, text),
  public.extend_subscription(uuid, uuid, int, text),
  public.record_payment(uuid, uuid, uuid, numeric, uuid, uuid, timestamptz, text, text),
  public.refund_payment(uuid, uuid, public.adjustment_type, numeric, text, uuid, uuid),
  public.check_in(uuid, uuid, public.checkin_method, text),
  public.check_out(uuid, uuid),
  public.correct_attendance(uuid, uuid, text, boolean, timestamptz, timestamptz),
  public.book_session(uuid, uuid, uuid),
  public.cancel_booking(uuid, uuid),
  public.convert_lead(uuid, uuid),
  public.refresh_notifications(uuid),
  public.dashboard_stats(uuid),
  public.revenue_report(uuid, date, date, text),
  public.revenue_by_plan(uuid, date, date),
  public.profit_and_loss(uuid, date, date)
to authenticated;
grant execute on function public.refresh_notifications(uuid) to service_role;

-- Helpers appelés dans les politiques / vues (exécutés avec les droits de l'appelant).
grant execute on function private.is_staff_of(uuid), private.has_permission(uuid, text),
  private.org_today(uuid), private.my_coach_id(uuid), private.member_is_mine(uuid, uuid),
  private.can_edit_program(uuid, uuid), private.can_edit_day(uuid, uuid),
  private.shares_org_with(uuid), private.try_uuid(text),
  private.membership_status(timestamptz, boolean, date, date, int) to authenticated;
