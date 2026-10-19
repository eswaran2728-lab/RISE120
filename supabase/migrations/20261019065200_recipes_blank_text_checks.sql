-- Roadmap D1 fix: a blank or whitespace-only text must not satisfy a publication rule (found by the live test: a
-- licence-evidence of a single space passed). Replaces the two constraints that check required text.
alter table public.recipes drop constraint recipes_published_complete;
alter table public.recipes add constraint recipes_published_complete check (
  status <> 'published' or (
    btrim(coalesce(name ->> 'en', '')) <> '' and btrim(coalesce(name ->> 'ms', '')) <> '' and btrim(coalesce(name ->> 'ta', '')) <> ''
    and jsonb_array_length(preparation) >= 1
    and nutrition is not null
    and btrim(coalesce(nutrition #>> '{provenance,name}', '')) <> ''
    and btrim(coalesce(nutrition #>> '{provenance,version}', '')) <> ''
    and coalesce(nutrition #>> '{provenance,accessedOn}', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and btrim(coalesce(nutrition #>> '{provenance,licenceEvidence}', '')) <> ''
  )
);

alter table public.recipes drop constraint recipes_reviewed_complete;
alter table public.recipes add constraint recipes_reviewed_complete check (
  (not verified and status <> 'published') or (
    reviewer is not null
    and btrim(coalesce(reviewer ->> 'name', '')) <> ''
    and btrim(coalesce(reviewer ->> 'role', '')) <> ''
    and coalesce(reviewer ->> 'reviewedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and status = 'published'
  )
);

alter table public.recipes drop constraint recipes_price_valid;
alter table public.recipes add constraint recipes_price_valid check (
  price is null or (
    coalesce(price ->> 'currency', '') ~ '^[A-Z]{3}$'
    and coalesce(price ->> 'amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
    and coalesce(price ->> 'pricedOn', '') ~ '^\d{4}-\d{2}-\d{2}$'
    and btrim(coalesce(price ->> 'source', '')) <> ''
    and coalesce(price ->> 'servings', '') ~ '^[0-9]+(\.[0-9]+)?$' and (price ->> 'servings')::numeric > 0
    and (region is distinct from 'MY' or price ->> 'currency' = 'MYR')
  )
);
