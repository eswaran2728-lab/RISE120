-- Phase 4 review: entitlements and app_config decide what a user may do, so clients get no write privilege on
-- them at all. Row-level security already hid every row from writes, but that was the only barrier; with the
-- privilege revoked, a future policy mistake cannot expose them, and a write attempt is answered with
-- "permission denied" instead of silently touching 0 rows.
--
-- Unchanged: clients still read their own entitlement and the configuration (select policies and grants), the
-- signup trigger still creates the free entitlement (it runs as the function owner), and the service role
-- (webhook, edge functions) still writes both.
revoke insert, update, delete on public.entitlements from anon, authenticated;
revoke insert, update, delete on public.app_config from anon, authenticated;
