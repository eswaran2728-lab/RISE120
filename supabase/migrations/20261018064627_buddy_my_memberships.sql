-- Roadmap E2: the app needs to know which of the listed members is the signed-in member (to show the right
-- actions), but the member list deliberately has no account ids. This function returns only the caller's own
-- member id and role in each of their groups, never anyone else's.
create function public.buddy_my_memberships()
returns table (group_id uuid, member_id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.group_id, m.member_id, m.role
  from public.buddy_members m
  where m.user_id = (select auth.uid())
$$;
revoke all on function public.buddy_my_memberships() from public, anon;
grant execute on function public.buddy_my_memberships() to authenticated;
