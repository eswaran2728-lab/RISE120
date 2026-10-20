-- Roadmap F2 Task 1: private image lifecycle and request admission for food photos. Additive only.
--
--   * A private bucket "food-photos", separate from check-in photos. A member may store one JPEG per generated request id
--     at "<user id>/<request id>.jpg" (no other name, no overwrite). Reads are own-only; the bucket is never public.
--   * A request ledger (one row per user and request id) is the unit of admission: it admits at most the daily allowance,
--     replays a completed result without a second provider call, and never regenerates an unknown outcome.
--   * Everything is closed by default: the provider kill switch (food_photo_enabled) is off, the capability is premium-only
--     (the same server rule as check-limit's photoFood), and an invalid configuration value fails closed.
--   * Temporary images live at most food_photo_retention_hours (24). Finished (completed or failed) requests have their image
--     deleted at once by the server; a scheduled server job removes anything older, including abandoned uploads. Deleting
--     rows from storage.objects with SQL would orphan the file, so the files are removed through the Storage API by the
--     food-photo-cleanup function; this migration only lists what is due and records what was deleted.
--   * Deleting an account deletes its ledger rows (cascade) and, in the delete-account function, its images.

insert into public.app_config (key, value) values
  ('food_photo_enabled', 'false'::jsonb),
  ('food_photo_per_day', '10'::jsonb),
  ('food_photo_retention_hours', '24'::jsonb)
on conflict (key) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('food-photos', 'food-photos', false, 1500000, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- The only object name a member may create: their own folder, a request id, .jpg. There is deliberately no update policy,
-- so an existing object cannot be overwritten.
create policy "food_photos_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'food-photos'
    and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$')
  );
create policy "food_photos_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "food_photos_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'food-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.food_photo_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  image_path text not null,
  quota_day date not null,
  status text not null check (status in ('reserved', 'completed', 'failed')),
  reserved_at timestamptz not null default now(),
  lease_until timestamptz not null,
  completed_at timestamptz,
  result jsonb check (result is null or (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 16384)),
  image_deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, request_id),
  check (image_path = user_id::text || '/' || request_id::text || '.jpg')
);
create index food_photo_requests_user_day_idx on public.food_photo_requests (user_id, quota_day, status);
create index food_photo_requests_cleanup_idx on public.food_photo_requests (status, image_deleted_at);

alter table public.food_photo_requests enable row level security;
create policy "food_photo_requests_select_own" on public.food_photo_requests for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.food_photo_requests from public, anon, authenticated;
grant select on public.food_photo_requests to authenticated;

-- Admit one request. status = reserved | in_progress | completed | limited | unavailable (with a reason).
create function private.food_photo_reserve(p_user_id uuid, p_request_id uuid, p_image_path text, p_lease_seconds integer default 120)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := private.quota_day();
  v_resets timestamptz := ((private.quota_day() + 1)::text || 'T00:00:00Z')::timestamptz;
  r public.food_photo_requests;
  v_enabled jsonb;
  v_allowance integer;
  v_used integer;
begin
  if p_image_path is distinct from (p_user_id::text || '/' || p_request_id::text || '.jpg') then
    raise exception 'INVALID_IMAGE_REF' using errcode = 'P0001';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 or p_lease_seconds > 3600 then
    raise exception 'FOOD_PHOTO_LEASE_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('foodphoto:' || p_user_id::text, 0));

  -- A stored answer is replayed whatever the switches say now; an unresolved request is never started a second time.
  select * into r from public.food_photo_requests where user_id = p_user_id and request_id = p_request_id;
  if found then
    if r.status = 'completed' then
      return jsonb_build_object('status', 'completed', 'result', r.result, 'resets_at', v_resets);
    end if;
    if r.status = 'reserved' then
      return jsonb_build_object('status', 'in_progress', 'resets_at', v_resets);
    end if;
    -- 'failed': the failure was known, so the id may be admitted again below.
  end if;

  select c.value into v_enabled from public.app_config c where c.key = 'food_photo_enabled';
  if v_enabled is distinct from 'true'::jsonb then
    return jsonb_build_object('status', 'unavailable', 'reason', 'disabled');
  end if;
  if not private.is_premium(p_user_id) then
    return jsonb_build_object('status', 'unavailable', 'reason', 'premium_required');
  end if;
  begin
    v_allowance := private.config_int('food_photo_per_day');
  exception when others then
    return jsonb_build_object('status', 'unavailable', 'reason', 'config');
  end;

  select count(*) into v_used
  from public.food_photo_requests q
  where q.user_id = p_user_id and q.quota_day = v_day and q.request_id <> p_request_id
    and (q.status = 'completed' or (q.status = 'reserved' and q.lease_until > now()));
  if v_used >= v_allowance then
    return jsonb_build_object('status', 'limited', 'resets_at', v_resets);
  end if;

  insert into public.food_photo_requests (user_id, request_id, image_path, quota_day, status, reserved_at, lease_until, updated_at)
  values (p_user_id, p_request_id, p_image_path, v_day, 'reserved', now(), now() + make_interval(secs => p_lease_seconds), now())
  on conflict (user_id, request_id) do update
    set status = 'reserved', quota_day = v_day, reserved_at = now(), lease_until = now() + make_interval(secs => p_lease_seconds),
        completed_at = null, result = null, image_deleted_at = null, updated_at = now();
  return jsonb_build_object('status', 'reserved', 'resets_at', v_resets);
end;
$$;

-- Store the one bounded result for a reserved request. The first result wins; an oversized or non-object result raises.
create function private.food_photo_complete(p_user_id uuid, p_request_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.food_photo_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended('foodphoto:' || p_user_id::text, 0));
  select * into r from public.food_photo_requests where user_id = p_user_id and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.status = 'completed' then
    return jsonb_build_object('status', 'completed', 'result', r.result);
  end if;
  if r.status <> 'reserved' then
    return jsonb_build_object('status', 'not_reserved');
  end if;
  if p_result is null or jsonb_typeof(p_result) <> 'object' or pg_column_size(p_result) > 16384 then
    raise exception 'RESULT_INVALID' using errcode = 'P0001';
  end if;
  update public.food_photo_requests set status = 'completed', result = p_result, completed_at = now(), updated_at = now()
  where user_id = p_user_id and request_id = p_request_id;
  return jsonb_build_object('status', 'completed', 'result', p_result);
end;
$$;

-- A known failure (no answer exists). Never touches a completed request, and does not count as a completed analysis.
create function private.food_photo_fail(p_user_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.food_photo_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended('foodphoto:' || p_user_id::text, 0));
  select * into r from public.food_photo_requests where user_id = p_user_id and request_id = p_request_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if r.status = 'completed' then
    return jsonb_build_object('status', 'completed');
  end if;
  update public.food_photo_requests set status = 'failed', lease_until = now(), updated_at = now()
  where user_id = p_user_id and request_id = p_request_id;
  return jsonb_build_object('status', 'failed');
end;
$$;

-- What the cleanup job must remove through the Storage API.
create function public.food_photo_finished_images()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select q.image_path from public.food_photo_requests q
  where q.status in ('completed', 'failed') and q.image_deleted_at is null
  order by q.updated_at limit 1000
$$;

create function public.food_photo_expired_images(p_retention_hours integer default null)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects o
  where o.bucket_id = 'food-photos'
    and o.created_at < now() - make_interval(hours => coalesce(p_retention_hours, private.config_int('food_photo_retention_hours')))
  order by o.created_at limit 1000
$$;

create function public.food_photo_mark_images_deleted(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.food_photo_requests set image_deleted_at = now(), updated_at = now()
  where image_path = any (p_paths) and image_deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.food_photo_reserve(p_user_id uuid, p_request_id uuid, p_image_path text, p_lease_seconds integer default 120)
returns jsonb language sql security definer set search_path = ''
as $$ select private.food_photo_reserve(p_user_id, p_request_id, p_image_path, p_lease_seconds) $$;
create function public.food_photo_complete(p_user_id uuid, p_request_id uuid, p_result jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.food_photo_complete(p_user_id, p_request_id, p_result) $$;
create function public.food_photo_fail(p_user_id uuid, p_request_id uuid)
returns jsonb language sql security definer set search_path = ''
as $$ select private.food_photo_fail(p_user_id, p_request_id) $$;

revoke all on function private.food_photo_reserve(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function private.food_photo_complete(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.food_photo_fail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.food_photo_reserve(uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.food_photo_complete(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.food_photo_fail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.food_photo_finished_images() from public, anon, authenticated;
revoke all on function public.food_photo_expired_images(integer) from public, anon, authenticated;
revoke all on function public.food_photo_mark_images_deleted(text[]) from public, anon, authenticated;
grant execute on function public.food_photo_reserve(uuid, uuid, text, integer) to service_role;
grant execute on function public.food_photo_complete(uuid, uuid, jsonb) to service_role;
grant execute on function public.food_photo_fail(uuid, uuid) to service_role;
grant execute on function public.food_photo_finished_images() to service_role;
grant execute on function public.food_photo_expired_images(integer) to service_role;
grant execute on function public.food_photo_mark_images_deleted(text[]) to service_role;

-- Scheduling (Supabase's documented mechanism: pg_cron calls an Edge Function through pg_net, with the secrets in Vault).
-- The job does nothing until the two Vault secrets "food_photo_cleanup_url" and "food_photo_cleanup_secret" exist, and the
-- function answers 401 without the matching FOOD_PHOTO_CLEANUP_SECRET, so a missing setup fails closed.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create function private.food_photo_cleanup_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'food_photo_cleanup_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'food_photo_cleanup_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function private.food_photo_cleanup_tick() from public, anon, authenticated;

select cron.schedule('food-photo-cleanup', '17 * * * *', 'select private.food_photo_cleanup_tick()');
