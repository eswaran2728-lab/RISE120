-- Initial profile and entitlement on signup. The trigger is invoked by Auth,
-- never by app clients; keep its security-definer function out of public API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.entitlements (user_id, tier) values (new.id, 'free');
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

insert into public.app_config (key, value) values
  ('free_plan_days', '14'::jsonb),
  ('free_food_logs_per_day', '3'::jsonb),
  ('free_ai_messages_per_day', '1'::jsonb),
  ('ad_rewards_max_per_day', '3'::jsonb),
  ('ad_reward_food_logs', '2'::jsonb),
  ('ad_reward_ai_messages', '1'::jsonb);
