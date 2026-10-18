-- Roadmap E1: private, invitation-only buddy groups.
--
-- What a group can see is deliberately tiny: each member's display name and the days on which they logged a
-- workout. Nothing from profiles, check-ins, food, photos or the coach is ever reachable through a group.
--
--   * Members read their own groups and the member list through column-limited grants and row-level security.
--     The list shows a random member id, a display name, a role and a join date; never an account id.
--   * Invitations, blocks and every write are server-only. Invitation tokens are random and only their SHA-256
--     is stored; an invitation expires, can be revoked, and is used once. An unknown, used, revoked, expired or
--     blocked invitation all answer the same neutral INVITE_UNAVAILABLE, so tokens cannot be probed.
--   * Joining or starting a group needs the member to have accepted the current disclosure version (checked by
--     the endpoint, recorded on the membership).
--   * Leaving, removal and blocking take effect immediately because access is decided on every read.
--   * Limits (group size, open invitations, invitation lifetime, groups per account) live in app_config.
--   * Deleting an account removes its memberships and the groups it owns.

insert into public.app_config (key, value) values
  ('buddy_max_group_size', '5'::jsonb),
  ('buddy_max_active_invites', '3'::jsonb),
  ('buddy_invite_ttl_hours', '72'::jsonb),
  ('buddy_max_groups_per_user', '3'::jsonb)
on conflict (key) do nothing;

create table public.buddy_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);

create table public.buddy_members (
  member_id uuid not null default gen_random_uuid() unique,
  group_id uuid not null references public.buddy_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 30),
  role text not null check (role in ('owner', 'member')),
  disclosure_version integer not null check (disclosure_version >= 1),
  joined_at timestamptz not null default clock_timestamp(),
  primary key (group_id, user_id)
);
create index buddy_members_user_idx on public.buddy_members (user_id);

create table public.buddy_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.buddy_groups(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.buddy_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

alter table public.buddy_groups enable row level security;
alter table public.buddy_members enable row level security;
alter table public.buddy_invites enable row level security;
alter table public.buddy_blocks enable row level security;

create function private.is_buddy_member(p_group_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.buddy_members m where m.group_id = p_group_id and m.user_id = p_user_id) $$;
revoke all on function private.is_buddy_member(uuid, uuid) from public, anon, authenticated;
grant execute on function private.is_buddy_member(uuid, uuid) to authenticated;

create policy "buddy_groups_select_member" on public.buddy_groups
  for select to authenticated
  using (private.is_buddy_member(id, (select auth.uid())));
create policy "buddy_members_select_member" on public.buddy_members
  for select to authenticated
  using (private.is_buddy_member(group_id, (select auth.uid())));

revoke all on public.buddy_groups, public.buddy_members, public.buddy_invites, public.buddy_blocks from anon, authenticated;
grant select (id, name, created_at) on public.buddy_groups to authenticated;
grant select (member_id, group_id, display_name, role, joined_at) on public.buddy_members to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- Server functions (service role only; the endpoint passes the verified account).
-- ---------------------------------------------------------------------------------------------------------------

create function public.buddy_create_group(p_user_id uuid, p_name text, p_display_name text, p_disclosure_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-user:' || p_user_id::text, 0));
  if (select count(*) from public.buddy_members where user_id = p_user_id) >= private.config_int('buddy_max_groups_per_user') then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;
  insert into public.buddy_groups (owner_id, name) values (p_user_id, p_name) returning id into v_group;
  insert into public.buddy_members (group_id, user_id, display_name, role, disclosure_version)
  values (v_group, p_user_id, p_display_name, 'owner', p_disclosure_version);
  return v_group;
end;
$$;

create function public.buddy_create_invite(p_user_id uuid, p_group_id uuid, p_token_hash text)
returns table (result_invite_id uuid, result_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  select m.role into v_role from public.buddy_members m where m.group_id = p_group_id and m.user_id = p_user_id;
  if v_role is null then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_role <> 'owner' then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;
  if (select count(*) from public.buddy_invites i
      where i.group_id = p_group_id and i.revoked_at is null and i.accepted_by is null and i.expires_at > now())
     >= private.config_int('buddy_max_active_invites') then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;
  v_expires := now() + make_interval(hours => private.config_int('buddy_invite_ttl_hours'));
  insert into public.buddy_invites (group_id, created_by, token_hash, expires_at)
  values (p_group_id, p_user_id, p_token_hash, v_expires)
  returning id into v_id;
  return query select v_id, v_expires;
end;
$$;

create function public.buddy_revoke_invite(p_user_id uuid, p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.buddy_invites i
  set revoked_at = now()
  where i.id = p_invite_id
    and i.revoked_at is null
    and exists (select 1 from public.buddy_members m where m.group_id = i.group_id and m.user_id = p_user_id and m.role = 'owner');
  if not found then
    raise exception 'INVITE_NOT_FOUND' using errcode = 'P0001';
  end if;
end;
$$;

create function public.buddy_accept_invite(p_user_id uuid, p_token_hash text, p_display_name text, p_disclosure_version integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.buddy_invites%rowtype;
begin
  -- The row lock makes competing accepts of one token run one after the other.
  select * into v_invite from public.buddy_invites where token_hash = p_token_hash for update;
  if not found or v_invite.revoked_at is not null or v_invite.accepted_by is not null or v_invite.expires_at <= now() then
    raise exception 'INVITE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || v_invite.group_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('buddy-user:' || p_user_id::text, 0));

  -- A block between the joiner and anyone already in the group looks exactly like an invitation that is gone.
  if exists (
    select 1 from public.buddy_members m
    join public.buddy_blocks b on (b.blocker_id = p_user_id and b.blocked_id = m.user_id) or (b.blocked_id = p_user_id and b.blocker_id = m.user_id)
    where m.group_id = v_invite.group_id
  ) then
    raise exception 'INVITE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.buddy_members m where m.group_id = v_invite.group_id and m.user_id = p_user_id) then
    raise exception 'ALREADY_MEMBER' using errcode = 'P0001';
  end if;
  if (select count(*) from public.buddy_members where user_id = p_user_id) >= private.config_int('buddy_max_groups_per_user') then
    raise exception 'LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.buddy_members where group_id = v_invite.group_id) >= private.config_int('buddy_max_group_size') then
    raise exception 'GROUP_FULL' using errcode = 'P0001';
  end if;

  insert into public.buddy_members (group_id, user_id, display_name, role, disclosure_version)
  values (v_invite.group_id, p_user_id, p_display_name, 'member', p_disclosure_version);
  update public.buddy_invites set accepted_by = p_user_id, accepted_at = now() where id = v_invite.id;
  return v_invite.group_id;
end;
$$;

-- Removes a membership. When the owner goes, the longest-standing member becomes owner; the last one out deletes
-- the group (and with it its invitations).
create function private.buddy_drop_member(p_group_id uuid, p_user_id uuid)
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

create function public.buddy_leave(p_user_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  if not private.is_buddy_member(p_group_id, p_user_id) then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform private.buddy_drop_member(p_group_id, p_user_id);
end;
$$;

create function public.buddy_remove_member(p_user_id uuid, p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  select role into v_role from public.buddy_members where group_id = p_group_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_role <> 'owner' then
    raise exception 'NOT_OWNER' using errcode = 'P0001';
  end if;
  select user_id into v_target from public.buddy_members where group_id = p_group_id and member_id = p_member_id;
  if v_target is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target = p_user_id then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  perform private.buddy_drop_member(p_group_id, v_target);
end;
$$;

-- Blocking: nobody blocked by someone, or blocking someone, shares a group with them from now on. The owner
-- removes the blocked member; anyone else leaves the group.
create function public.buddy_block_member(p_user_id uuid, p_group_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_target uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('buddy-group:' || p_group_id::text, 0));
  select role into v_role from public.buddy_members where group_id = p_group_id and user_id = p_user_id;
  if v_role is null then
    raise exception 'GROUP_NOT_FOUND' using errcode = 'P0001';
  end if;
  select user_id into v_target from public.buddy_members where group_id = p_group_id and member_id = p_member_id;
  if v_target is null then
    raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_target = p_user_id then
    raise exception 'INVALID_TARGET' using errcode = 'P0001';
  end if;
  insert into public.buddy_blocks (blocker_id, blocked_id) values (p_user_id, v_target) on conflict do nothing;
  perform private.buddy_drop_member(p_group_id, case when v_role = 'owner' then v_target else p_user_id end);
end;
$$;

-- The only thing a group can see about its members: display name and the days with a logged workout.
create function public.buddy_summary(p_user_id uuid, p_group_id uuid, p_from date, p_to date)
returns table (result_member_id uuid, result_display_name text, result_days date[])
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
    select m.member_id,
           m.display_name,
           coalesce(
             (select array_agg(d order by d)
                from (select distinct l.log_date as d from public.workout_logs l
                      where l.user_id = m.user_id and l.log_date between p_from and p_to) days),
             '{}'::date[]
           )
    from public.buddy_members m
    where m.group_id = p_group_id
    order by m.joined_at, m.member_id;
end;
$$;

revoke all on function public.buddy_create_group(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.buddy_create_invite(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.buddy_revoke_invite(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_accept_invite(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function private.buddy_drop_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_leave(uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_remove_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_block_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.buddy_summary(uuid, uuid, date, date) from public, anon, authenticated;
grant execute on function public.buddy_create_group(uuid, text, text, integer) to service_role;
grant execute on function public.buddy_create_invite(uuid, uuid, text) to service_role;
grant execute on function public.buddy_revoke_invite(uuid, uuid) to service_role;
grant execute on function public.buddy_accept_invite(uuid, text, text, integer) to service_role;
grant execute on function public.buddy_leave(uuid, uuid) to service_role;
grant execute on function public.buddy_remove_member(uuid, uuid, uuid) to service_role;
grant execute on function public.buddy_block_member(uuid, uuid, uuid) to service_role;
grant execute on function public.buddy_summary(uuid, uuid, date, date) to service_role;
