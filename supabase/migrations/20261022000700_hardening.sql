-- =============================================================================
-- 0007 · Durcissement (Supabase Security Advisor, lint 0011) :
-- search_path figé sur les fonctions utilitaires et triggers restants.
-- Les fonctions n'utilisent que pg_catalog (toujours résolu en premier).
-- =============================================================================
alter function private.touch_updated_at() set search_path = '';
alter function private.members_guard() set search_path = '';
alter function private.payments_immutable() set search_path = '';
alter function private.adjustments_immutable() set search_path = '';
alter function private.compute_end_date(date, int, public.duration_unit) set search_path = '';
alter function private.try_uuid(text) set search_path = '';
alter function private.membership_status(timestamptz, boolean, date, date, int) set search_path = '';
