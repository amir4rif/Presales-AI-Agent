-- Keep prospect opportunity lists precise. New deals opened from a prospect
-- carry this foreign key; name matching remains only as an exact legacy fallback.

alter table public.deals
  add column prospect_id bigint references public.prospects(id) on delete set null;

create index deals_prospect_id_idx on public.deals(prospect_id);

create or replace function private.normalize_prospect_name()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'Prospect name cannot be empty.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_prospect_name()
  from public, anon, authenticated;

update public.prospects
set name = btrim(name)
where name is distinct from btrim(name);

create trigger prospects_normalize_name
before insert or update of name on public.prospects
for each row execute function private.normalize_prospect_name();

alter table public.prospects
  add constraint prospects_name_not_blank check (btrim(name) <> '');

comment on column public.deals.prospect_id is
  'Stable prospect relationship used instead of partial account-name matching.';
