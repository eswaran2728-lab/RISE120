-- Check-in contract: mood is 1 (very low) to 5 (great); weight 30-300 kg and sleep 0-24 h already checked.
alter table public.checkins
  add constraint checkins_mood_range check (mood is null or mood between 1 and 5);

-- Private bucket for progress photos. Objects live under "<user id>/<file>" and only that user
-- can read or write them. Reads use short-lived signed URLs; the bucket is never public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "checkin_photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "checkin_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "checkin_photos_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "checkin_photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'checkin-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
