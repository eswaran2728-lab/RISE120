-- Phase 4, Task 3: RevenueCat entitlement synchronisation.
--
-- Premium access is changed only by the revenuecat-webhook function (service role), after it has
-- authenticated a RevenueCat event. Two additive server-only tables back that:
--   revenuecat_events  the event ledger, one row per (RevenueCat event id, user): makes retries idempotent
--                      and leaves an audit trail of what was applied or discarded as stale.
--   billing_state      the newest applied event time and the premium expiry per user: lets a late or
--                      replayed older event be recognised and discarded, so it can never restore access
--                      after a newer expiration, refund or revocation.
-- Clients cannot read or write either table, or call the function; entitlements stays read-only for them.

create table public.billing_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_event_ms bigint not null default 0,
  premium_active boolean not null default false,
  premium_until_ms bigint, -- null while premium_active means lifetime access
  updated_at timestamptz not null default now()
);

create table public.revenuecat_events (
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_ms bigint not null,
  effect text not null check (effect in ('grant', 'revoke')),
  until_ms bigint,
  outcome text not null check (outcome in ('applied', 'stale')),
  received_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.billing_state enable row level security;
alter table public.revenuecat_events enable row level security;
revoke all on public.billing_state from public, anon, authenticated;
revoke all on public.revenuecat_events from public, anon, authenticated;

-- Applies one already-authenticated access change atomically for one user.
--   'duplicate'    this event id was already recorded for the user; nothing changes
--   'stale'        an event newer than this one was already applied; recorded, nothing changes
--   'unknown_user' no such account; nothing recorded
--   'applied'      state and entitlements.tier updated
-- Access is premium only when the newest applied event is a grant that is open-ended or not yet expired.
create function public.apply_billing_effect(
  p_event_id text,
  p_event_type text,
  p_event_ms bigint,
  p_user_id uuid,
  p_effect text,
  p_until_ms bigint
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.billing_state;
  v_now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_active boolean;
  v_outcome text;
begin
  if p_effect not in ('grant', 'revoke') then
    raise exception 'BILLING_EFFECT_INVALID';
  end if;
  if not exists (select 1 from public.entitlements where user_id = p_user_id) then
    return 'unknown_user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('billing:' || p_user_id::text, 0));

  if exists (select 1 from public.revenuecat_events where event_id = p_event_id and user_id = p_user_id) then
    return 'duplicate';
  end if;

  insert into public.billing_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  select * into v_state from public.billing_state where user_id = p_user_id for update;

  if p_event_ms < v_state.last_event_ms then
    v_outcome := 'stale';
  else
    v_outcome := 'applied';
    v_active := p_effect = 'grant' and (p_until_ms is null or p_until_ms > v_now_ms);

    update public.billing_state
       set last_event_ms = p_event_ms,
           premium_active = v_active,
           premium_until_ms = case when p_effect = 'grant' then p_until_ms end,
           updated_at = now()
     where user_id = p_user_id;

    update public.entitlements
       set tier = case when v_active then 'premium' else 'free' end,
           source = 'revenuecat',
           updated_at = now()
     where user_id = p_user_id;
  end if;

  insert into public.revenuecat_events (event_id, user_id, event_type, event_ms, effect, until_ms, outcome)
  values (p_event_id, p_user_id, p_event_type, p_event_ms, p_effect, p_until_ms, v_outcome);

  return v_outcome;
end;
$$;

revoke all on function public.apply_billing_effect(text, text, bigint, uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.apply_billing_effect(text, text, bigint, uuid, text, bigint) to service_role;
