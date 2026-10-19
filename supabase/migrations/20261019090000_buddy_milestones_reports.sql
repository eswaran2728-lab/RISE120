-- Roadmap E2: private completion milestones, and reports with a restricted moderation workflow. Additive only.
--
--   * Participation is counted from distinct logged workout days (workout_logs.log_date, a local calendar day), so a
--     day is worth at most one point however many sets, entries, syncs or activities it has.
--   * A milestone ("N workout days") is computed on the server from that count and is shared into one group only by an
--     explicit request. A share carries a name and a number, nothing else. Withdrawing, leaving, removal, blocking,
--     expiry and account deletion take it out of every group's view at once (reads re-check all of it).
--   * Every share request id is remembered, so a delayed replay of a withdrawn share cannot bring it back.
--   * Reports are stored for authorised review only. Members cannot read or write them; there is no moderation
--     queue for ordinary members and no public chat. Reporting stays closed until the owner turns it on AND at least
--     one moderator is named (docs/product/buddy-moderation.md), so the app cannot claim a process that does not exist.
--   * Deleting an account deletes its shares, its share requests and the reports it filed or that name it.

insert into public.app_config (key, value) values
  ('buddy_milestone_days', '[7,14,30,60,90,120]'::jsonb),
  ('buddy_share_ttl_days', '30'::jsonb),
  ('buddy_reports_enabled', 'false'::jsonb),
  ('buddy_reports_per_day', '5'::jsonb)
on conflict (key) do nothing;

create table public.buddy_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.buddy_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone integer not null check (milestone >= 1),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  withdrawn_at timestamptz,
  unique (group_id, user_id, milestone)
);

create table public.buddy_share_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  group_id uuid not null references public.buddy_groups(id) on delete cascade,
  milestone integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

create table public.buddy_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

create table public.buddy_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reported_user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid,
  group_name text,
  reporter_display_name text,
  reported_display_name text,
  reason text not null check (reason in ('harassment', 'spam', 'unsafe', 'other')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'in_review', 'closed')),
  resolution text check (resolution in ('no_action', 'removed_from_group', 'other')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (reporter_id, request_id),
  check ((status = 'closed') = (resolution is not null)),
  check (reporter_id <> reported_user_id)
);
create unique index buddy_reports_one_open on public.buddy_reports (reporter_id, reported_user_id, group_id) where status <> 'closed';
create index buddy_reports_status_idx on public.buddy_reports (status, created_at);

alter table public.buddy_shares enable row level security;
alter table public.buddy_share_requests enable row level security;
alter table public.buddy_moderators enable row level security;
alter table public.buddy_reports enable row level security;
revoke all on public.buddy_shares, public.buddy_share_requests, public.buddy_moderators, public.buddy_reports from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Participation and milestones
-- ---------------------------------------------------------------------------------------------------------------

create function private.buddy_thresholds()
returns integer[]
language sql
stable
set search_path = ''
as $$
  select coalesce((select array_agg(x::integer order by x::integer)
                     from jsonb_array_elements_text((select c.value from public.app_config c where c.key = 'buddy_milestone_days')) x), '{}'::integer[])
$$;

-- One point per local day with a logged workout, whatever else happened that day.
create function private.buddy_days(p_user_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$ select count(distinct l.log_date)::integer from public.workout_logs l where l.user_id = p_user_id $$;

create function public.buddy_milestones(p_user_id uuid)
returns table (result_days integer, result_milestone integer, result_shared_in uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := private.buddy_days(p_user_id);
begin
  return query
    with earned as (select t from unnest(private.buddy_thresholds()) t where t <= v_days)
    select v_days, e.t,
           coalesce(array(select s.group_id from public.buddy_shares s
                          where s.user_id = p_user_id and s.milestone = e.t and s.withdrawn_at is null and s.expires_at > now()), '{}'::uuid[])
    from earned e
    union all
    select v_days, null::integer, '{}'::uuid[] where not exists (select 1 from earned)
    order by 2 nulls last;
end;
$$;

create function public.buddy_share_milestone(p_user_id uuid, p_group_id uuid, p_milestone integer, p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_share public.buddy_shares%rowtype;
  v_seen boolean;
  v_has boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  if not private.is_buddy_member(p_group_id, p_user_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_milestone = any (private.buddy_thresholds())) or private.buddy_days(p_user_id) < p_milestone then
    raise exception 'MILESTONE_NOT_EARNED' using errcode = 'P0001';
  end if;

  select * into v_share from public.buddy_shares where group_id = p_group_id and user_id = p_user_id and milestone = p_milestone for update;
  v_has := found;
  select exists (select 1 from public.buddy_share_requests r where r.user_id = p_user_id and r.request_id = p_request_id) into v_seen;

  if v_seen then
    -- A repeat of a request already answered. It shows nothing new: if the share has since been withdrawn (or removed
    -- with the membership) a late repeat must not bring it back.
    if not v_has or v_share.withdrawn_at is not null or v_share.expires_at <= now() then
      raise exception 'SHARE_WITHDRAWN' using errcode = 'P0001';
    end if;
    return;
  end if;

  insert into public.buddy_share_requests (user_id, request_id, group_id, milestone) values (p_user_id, p_request_id, p_group_id, p_milestone);
  if v_has then
    update public.buddy_shares
    set created_at = case when withdrawn_at is not null or expires_at <= now() then now() else created_at end,
        expires_at = case when withdrawn_at is not null or expires_at <= now() then now() + make_interval(days => private.config_int('buddy_share_ttl_days')) else expires_at end,
        withdrawn_at = null
    where id = v_share.id;
  else
    insert into public.buddy_shares (group_id, user_id, milestone, expires_at)
    values (p_group_id, p_user_id, p_milestone, now() + make_interval(days => private.config_int('buddy_share_ttl_days')));
  end if;
end;
$$;

create function public.buddy_withdraw_share(p_user_id uuid, p_group_id uuid, p_milestone integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.buddy_shares s set withdrawn_at = now()
  where s.group_id = p_group_id and s.user_id = p_user_id and s.milestone = p_milestone and s.withdrawn_at is null;
  if not found and not exists (select 1 from public.buddy_shares s where s.group_id = p_group_id and s.user_id = p_user_id and s.milestone = p_milestone) then
    raise exception 'SHARE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

-- What a group can read about milestones: a member's name and a number, only while that member is still in the group,
-- the share is not withdrawn and has not expired. Never an account id.
create function public.buddy_group_shares(p_user_id uuid, p_group_id uuid)
returns table (result_member_id uuid, result_display_name text, result_milestone integer, result_shared_at timestamptz, result_mine boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_buddy_member(p_group_id, p_user_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  return query
    select m.member_id, m.display_name, s.milestone, s.created_at, (s.user_id = p_user_id)
    from public.buddy_shares s
    join public.buddy_members m on m.group_id = s.group_id and m.user_id = s.user_id
    where s.group_id = p_group_id and s.withdrawn_at is null and s.expires_at > now()
    order by s.created_at, s.milestone, m.member_id;
end;
$$;

-- Leaving, removal and blocking all end in here: the member's shares go with their membership.
create or replace function private.buddy_drop_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_next uuid;
begin
  select role into v_role from public.buddy_members where group_id = p_group_id and user_id = p_user_id;
  delete from public.buddy_shares where group_id = p_group_id and user_id = p_user_id;
  delete from public.buddy_members where group_id = p_group_id and user_id = p_user_id;
  select user_id into v_next from public.buddy_members where group_id = p_group_id order by joined_at, member_id limit 1;
  if v_next is null then
    delete from public.buddy_groups where id = p_group_id;
  elsif v_role = 'owner' then
    update public.buddy_members set role = 'owner' where group_id = p_group_id and user_id = v_next;
    update public.buddy_groups set owner_id = v_next where id = p_group_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Reports and moderation
-- ---------------------------------------------------------------------------------------------------------------

-- Open only when the owner has switched reporting on and someone is named to handle reports.
create function public.buddy_reports_open()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select c.value = 'true'::jsonb from public.app_config c where c.key = 'buddy_reports_enabled'), false)
     and exists (select 1 from public.buddy_moderators)
$$;

create function public.buddy_submit_report(p_user_id uuid, p_group_id uuid, p_member_id uuid, p_reason text, p_note text, p_request_id uuid)
returns table (result_report_id uuid, result_received_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid;
  v_target_name text;
  v_my_name text;
  v_group_name text;
  v_existing public.buddy_reports%rowtype;
begin
  if not public.buddy_reports_open() then
    raise exception 'REPORTING_UNAVAILABLE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  select m.display_name into v_my_name from public.buddy_members m where m.group_id = p_group_id and m.user_id = p_user_id;
  if v_my_name is null then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_existing from public.buddy_reports r where r.reporter_id = p_user_id and r.request_id = p_request_id;
  if found then
    return query select v_existing.id, v_existing.created_at;
    return;
  end if;

  select m.user_id, m.display_name into v_target, v_target_name from public.buddy_members m where m.group_id = p_group_id and m.member_id = p_member_id;
  if v_target is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target = p_user_id then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;

  -- A second report about the same person in the same group, while one is still open, is acknowledged with the first.
  select * into v_existing from public.buddy_reports r
  where r.reporter_id = p_user_id and r.reported_user_id = v_target and r.group_id = p_group_id and r.status <> 'closed';
  if found then
    return query select v_existing.id, v_existing.created_at;
    return;
  end if;

  if (select count(*) from public.buddy_reports r where r.reporter_id = p_user_id and r.created_at > now() - interval '24 hours')
     >= private.config_int('buddy_reports_per_day') then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;

  select g.name into v_group_name from public.buddy_groups g where g.id = p_group_id;
  return query
    insert into public.buddy_reports (reporter_id, reported_user_id, group_id, group_name, reporter_display_name, reported_display_name, reason, note, request_id)
    values (p_user_id, v_target, p_group_id, v_group_name, v_my_name, v_target_name, p_reason, nullif(btrim(p_note), ''), p_request_id)
    returning id, created_at;
end;
$$;

create function private.buddy_assert_moderator(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.buddy_moderators m where m.user_id = p_user_id) then
    raise exception 'NOT_AUTHORISED' using errcode = 'P0001';
  end if;
end;
$$;

-- What a moderator sees: the report and the names involved. No account ids, logs, weights, photos, meals or coach text.
create function public.buddy_moderation_queue(p_user_id uuid)
returns table (result_id uuid, result_status text, result_reason text, result_note text, result_created_at timestamptz, result_group_name text,
               result_reporter_name text, result_reported_name text, result_reported_in_group boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.buddy_assert_moderator(p_user_id);
  return query
    select r.id, r.status, r.reason, r.note, r.created_at, r.group_name, r.reporter_display_name, r.reported_display_name,
           exists (select 1 from public.buddy_members m where m.group_id = r.group_id and m.user_id = r.reported_user_id)
    from public.buddy_reports r
    where r.status <> 'closed'
    order by r.created_at, r.id;
end;
$$;

create function public.buddy_moderation_start_review(p_user_id uuid, p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform private.buddy_assert_moderator(p_user_id);
  select status into v_status from public.buddy_reports where id = p_report_id for update;
  if v_status is null then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_status = 'closed' then
    raise exception 'REPORT_CLOSED' using errcode = 'P0001';
  end if;
  update public.buddy_reports set status = 'in_review', reviewed_by = p_user_id where id = p_report_id;
end;
$$;

create function public.buddy_moderation_resolve(p_user_id uuid, p_report_id uuid, p_resolution text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report public.buddy_reports%rowtype;
begin
  perform private.buddy_assert_moderator(p_user_id);
  select * into v_report from public.buddy_reports where id = p_report_id for update;
  if not found then
    raise exception 'REPORT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_report.status = 'closed' then
    raise exception 'REPORT_CLOSED' using errcode = 'P0001';
  end if;
  if p_resolution = 'removed_from_group' and v_report.group_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || v_report.group_id::text, 0));
    if private.is_buddy_member(v_report.group_id, v_report.reported_user_id) then
      perform private.buddy_drop_member(v_report.group_id, v_report.reported_user_id);
    end if;
  end if;
  update public.buddy_reports
  set status = 'closed', resolution = p_resolution, resolution_note = nullif(btrim(p_note), ''), reviewed_by = p_user_id, reviewed_at = now()
  where id = p_report_id;
end;
$$;

revoke all on function private.buddy_thresholds() from public, anon, authenticated;
revoke all on function private.buddy_days(uuid) from public, anon, authenticated;
revoke all on function private.buddy_assert_moderator(uuid) from public, anon, authenticated;
revoke all on function public.buddy_milestones(uuid) from public, anon, authenticated;
revoke all on function public.buddy_share_milestone(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.buddy_withdraw_share(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.buddy_group_shares(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_reports_open() from public, anon, authenticated;
revoke all on function public.buddy_submit_report(uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.buddy_moderation_queue(uuid) from public, anon, authenticated;
revoke all on function public.buddy_moderation_start_review(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_moderation_resolve(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.buddy_milestones(uuid) to service_role;
grant execute on function public.buddy_share_milestone(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.buddy_withdraw_share(uuid, uuid, integer) to service_role;
grant execute on function public.buddy_group_shares(uuid, uuid) to service_role;
grant execute on function public.buddy_reports_open() to service_role;
grant execute on function public.buddy_submit_report(uuid, uuid, uuid, text, text, uuid) to service_role;
grant execute on function public.buddy_moderation_queue(uuid) to service_role;
grant execute on function public.buddy_moderation_start_review(uuid, uuid) to service_role;
grant execute on function public.buddy_moderation_resolve(uuid, uuid, text, text) to service_role;
