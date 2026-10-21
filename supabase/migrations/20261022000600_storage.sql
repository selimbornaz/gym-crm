-- =============================================================================
-- 0006 · Stockage Supabase (photos de membres, logos, documents).
-- =============================================================================
-- Convention de chemin : `<organization_id>/<...>`. Les politiques lisent le
-- premier segment du chemin pour vérifier la salle => pas d'accès inter-salles.
-- Tous les buckets sont privés : les fichiers sont servis par URL signée.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('member-photos', 'member-photos', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp']),
  ('org-assets', 'org-assets', false, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
on conflict (id) do nothing;

create policy "member photos: lecture personnel" on storage.objects for select to authenticated
  using (bucket_id = 'member-photos'
         and private.is_staff_of(private.try_uuid((storage.foldername(name))[1])));

create policy "member photos: ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'member-photos'
              and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'members.write'));

create policy "member photos: remplacement" on storage.objects for update to authenticated
  using (bucket_id = 'member-photos'
         and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'members.write'));

create policy "member photos: suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'member-photos'
         and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'members.write'));

create policy "org assets: lecture personnel" on storage.objects for select to authenticated
  using (bucket_id = 'org-assets'
         and private.is_staff_of(private.try_uuid((storage.foldername(name))[1])));

create policy "org assets: gestion" on storage.objects for all to authenticated
  using (bucket_id = 'org-assets'
         and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'settings.manage'))
  with check (bucket_id = 'org-assets'
              and private.has_permission(private.try_uuid((storage.foldername(name))[1]), 'settings.manage'));
