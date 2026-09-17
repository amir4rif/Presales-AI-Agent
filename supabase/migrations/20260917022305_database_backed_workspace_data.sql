-- Move every runtime business catalog and user-owned workspace value into
-- Supabase. This migration intentionally inserts reference configuration only;
-- it does not insert prospects, deals, proposals, compliance answers, users,
-- or any other demo/customer records.

create table public.workspace_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint workspace_config_value_is_array_or_object
    check (jsonb_typeof(value) in ('array', 'object'))
);

create trigger workspace_config_set_updated_at
before update on public.workspace_config
for each row execute function private.set_updated_at();

alter table public.workspace_config enable row level security;

create policy "workspace_config_select_authenticated"
on public.workspace_config for select
to authenticated
using (true);

create policy "workspace_config_insert_level3"
on public.workspace_config for insert
to authenticated
with check (private.current_access_level() >= 3);

create policy "workspace_config_update_level3"
on public.workspace_config for update
to authenticated
using (private.current_access_level() >= 3)
with check (private.current_access_level() >= 3);

create policy "workspace_config_delete_level3"
on public.workspace_config for delete
to authenticated
using (private.current_access_level() >= 3);

revoke all on public.workspace_config from public, anon, authenticated;
grant select, insert, update, delete on public.workspace_config to authenticated;

insert into public.workspace_config (key, value) values
  ('pipeline_stages', '[
    {"id":1,"name":"Prospecting","sla":7,"prob":0.10},
    {"id":2,"name":"Qualifying Leads","sla":7,"prob":0.20},
    {"id":3,"name":"Initial Meeting","sla":14,"prob":0.30},
    {"id":4,"name":"Define Prospect Needs","sla":14,"prob":0.40},
    {"id":5,"name":"Make An Offer","sla":14,"prob":0.55},
    {"id":6,"name":"Negotiation / Finalize","sla":21,"prob":0.70},
    {"id":7,"name":"Closing The Deal","sla":14,"prob":0.90},
    {"id":8,"name":"Deliver The Product","sla":30,"prob":1.00}
  ]'::jsonb),
  ('deal_sources', '["Inbound","Outbound","Partner","Proposal"]'::jsonb),
  ('deal_loss_reasons', '[
    "Chose competitor","Budget cut","No decision","Pricing too high","Timing","Other"
  ]'::jsonb),
  ('disqualification_reasons', '[
    "Compliance","Blacklisted account","Out of scope","Wrong product fit"
  ]'::jsonb),
  ('proposal_rejection_reasons', '[
    {"label":"Pricing too high","terminal":false},
    {"label":"Scope mismatch","terminal":false},
    {"label":"Wrong product fit","terminal":true},
    {"label":"Missing information","terminal":false},
    {"label":"Compliance","terminal":true},
    {"label":"Blacklisted account","terminal":true},
    {"label":"Formatting/quality","terminal":false},
    {"label":"Out of scope","terminal":true},
    {"label":"Other","terminal":false}
  ]'::jsonb),
  ('prospect_industries', '[
    "Banking & Finance","Healthcare","Government","Education","Manufacturing",
    "Retail & FMCG","NGO / Non-profit","Technology","Logistics & Supply Chain",
    "Telecommunications","Property & Construction","Oil & Gas","Other"
  ]'::jsonb),
  ('employee_sizes', '[
    "1 – 50","51 – 200","201 – 500","501 – 1,000","1,001 – 5,000",
    "5,001 – 10,000","10,000+"
  ]'::jsonb),
  ('it_budget_ranges', '[
    "Below RM 500K","RM 500K – RM 1M","RM 1M – RM 3M","RM 3M – RM 10M",
    "RM 10M – RM 50M","Above RM 50M"
  ]'::jsonb),
  ('hr_budget_ranges', '[
    "Below RM 200K","RM 200K – RM 500K","RM 500K – RM 1M","RM 1M – RM 3M",
    "RM 3M – RM 10M","Above RM 10M"
  ]'::jsonb),
  ('buying_timelines', '[
    "Immediate (within 1 month)","Short-term (1 – 3 months)",
    "Medium-term (3 – 6 months)","Long-term (6 – 12 months)",
    "Future planning (12+ months)"
  ]'::jsonb),
  ('access_roles', '[
    {"role":"Sales Representative","level":1,"label":"Data Entry","description":"Submit prospect data, update deal records, and view own assigned pipeline only.","default":true},
    {"role":"Pre-Sales","level":1,"label":"Data Entry","description":"Submit prospect data, update deal records, and view own assigned pipeline only.","default":false},
    {"role":"Sales Manager","level":2,"label":"Reviewer","description":"Review and validate Level 1 submissions. Edit records and view team-wide pipeline.","default":false},
    {"role":"Sales Operations","level":3,"label":"Administrator","description":"Full system access, settings, exports, and user management.","default":false},
    {"role":"COO Office","level":3,"label":"Administrator","description":"Full system access, settings, exports, and user management.","default":false}
  ]'::jsonb),
  ('analytics_settings', '{"minimumCompletedProjects":3}'::jsonb),
  ('pipeline_settings', '{
    "defaultMovement":"Advanced",
    "defaultStatus":"On Track",
    "proposalDecisionSource":"Proposal",
    "outcomeEscalationDays":14,
    "closeDateCriticalDays":14,
    "closeDateWarningDays":30,
    "valueBands":[
      {"label":"< RM 2M","tone":"high","maxExclusive":2000000},
      {"label":"RM 2M – 3.5M","tone":"medium","minInclusive":2000000,"maxInclusive":3500000},
      {"label":"> RM 3.5M","tone":"low","minExclusive":3500000}
    ]
  }'::jsonb),
  ('notification_rules', '[
    {"id":"reject","label":"Notify me when my proposal is rejected","defaultEnabled":true},
    {"id":"approve","label":"Notify me when my proposal is approved","defaultEnabled":true},
    {"id":"pending","label":"Notify me when a proposal awaits my review","defaultEnabled":true}
  ]'::jsonb),
  ('product_catalog', '[
    {"category":"RAMS PeopleTech","name":"Oracle Fusion HCM","description":"Enterprise HR, payroll, and talent management","fit":"Large enterprise with 1,000+ employees"},
    {"category":"RAMS PeopleTech","name":"Darwinbox","description":"Mid-market HCM cloud platform","fit":"Southeast Asian organizations with 200–5,000 employees"},
    {"category":"RAMS PeopleTech","name":"Hono.ai","description":"AI-powered HR and workforce analytics","fit":"Organizations seeking workforce intelligence"},
    {"category":"RAMS PeopleTech","name":"RAMCO Payce","description":"Complex multi-country payroll automation","fit":"Organizations operating payroll across countries"},
    {"category":"RAMS A.I.Tech","name":"iFlytek AI Platform","description":"NLP, speech recognition, and AI solutions","fit":"AI-enabled customer and employee workflows"},
    {"category":"RAMS A.I.Tech","name":"Tencent Cloud","description":"Cloud infrastructure, AI services, and private cloud","fit":"Cloud modernization and managed infrastructure"},
    {"category":"RAMS AutoTech","name":"RPA and industrial automation","description":"Robotic process and industrial automation solutions","fit":"Manual or repetitive operational processes"},
    {"category":"RAMS EduTech","name":"Education technology platforms","description":"Learning management and student lifecycle platforms","fit":"Education providers and training organizations"},
    {"category":"RAMS MarTech","name":"CRM and digital marketing automation","description":"Customer relationship and marketing automation solutions","fit":"Sales and marketing transformation"}
  ]'::jsonb)
on conflict (key) do nothing;

-- New profiles obtain their default role from the database-backed role catalog.
alter table public.profiles
  alter column role drop default,
  alter column level drop default;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text := coalesce(new.raw_user_meta_data ->> 'first_name', '');
  family_name text := coalesce(new.raw_user_meta_data ->> 'last_name', '');
  display_name text;
  default_role text;
  default_level smallint;
begin
  if nullif(pg_catalog.btrim(coalesce(new.email, '')), '') is null then
    raise exception 'An email address is required to create an application profile.'
      using errcode = '23514';
  end if;

  select role_item ->> 'role', (role_item ->> 'level')::smallint
  into default_role, default_level
  from public.workspace_config as config,
       jsonb_array_elements(config.value) as role_item
  where config.key = 'access_roles'
    and coalesce((role_item ->> 'default')::boolean, false)
  limit 1;

  if default_role is null or default_level is null then
    raise exception 'No default access role is configured.' using errcode = '23514';
  end if;

  display_name := nullif(trim(concat_ws(' ', given_name, family_name)), '');
  display_name := coalesce(display_name, split_part(new.email, '@', 1));

  insert into public.profiles (
    id, first_name, last_name, full_name, email, role, level
  ) values (
    new.id,
    given_name,
    family_name,
    display_name,
    new.email,
    default_role,
    default_level
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Prospect notes are shared application data. The two legacy aggregate columns
-- remain in the physical schema for a non-destructive production rollout, but
-- the application no longer selects, maps, writes, displays, or checks them.
-- Opportunity count/value are always derived from persisted deals.
alter table public.prospects
  add column if not exists notes text not null default '';

comment on column public.prospects.opportunities is
  'Deprecated and ignored by the application; derive the count from deals.prospect_id.';
comment on column public.prospects.total_value is
  'Deprecated and ignored by the application; derive the value from deals.prospect_id.';

create or replace function private.prevent_linked_prospect_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if exists (
      select 1 from public.deals as deal where deal.prospect_id = old.id
    )
    or exists (
      select 1 from public.closed_deals as deal where deal.prospect_id = old.id
    )
    or exists (
      select 1 from public.proposals as proposal where proposal.prospect_id = old.id
    )
  then
    raise exception using
      errcode = '23503',
      message = format('Prospect "%s" has linked work and must be archived instead.', old.name);
  end if;

  return old;
end;
$$;

revoke all on function private.prevent_linked_prospect_delete() from public;

comment on function private.prevent_linked_prospect_delete() is
  'Blocks deletion from live prospect_id relationships only; no stored aggregate counters or display-name matching.';

create table public.notification_preferences (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('approve', 'reject', 'pending')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, event_type)
);

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function private.set_updated_at();

alter table public.notification_preferences enable row level security;

create policy "notification_preferences_select_own"
on public.notification_preferences for select
to authenticated
using (user_id = (select auth.uid()));

create policy "notification_preferences_insert_own"
on public.notification_preferences for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "notification_preferences_update_own"
on public.notification_preferences for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "notification_preferences_delete_own"
on public.notification_preferences for delete
to authenticated
using (user_id = (select auth.uid()));

revoke all on public.notification_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

create table public.compliance_rows (
  id bigint generated by default as identity primary key,
  owner_id uuid not null default auth.uid() references public.profiles(id),
  document_name text not null,
  row_number integer not null check (row_number > 0),
  requirement text not null,
  answer text not null default '',
  confidence text check (confidence is null or confidence in ('High', 'Medium', 'Low')),
  reason text not null default '',
  source_reference text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, document_name, row_number)
);

create index compliance_rows_owner_document_idx
  on public.compliance_rows(owner_id, document_name, row_number);

create trigger compliance_rows_set_updated_at
before update on public.compliance_rows
for each row execute function private.set_updated_at();

alter table public.compliance_rows enable row level security;

create policy "compliance_rows_select_by_level"
on public.compliance_rows for select
to authenticated
using (owner_id = (select auth.uid()) or private.current_access_level() >= 2);

create policy "compliance_rows_insert_by_level"
on public.compliance_rows for insert
to authenticated
with check (owner_id = (select auth.uid()) or private.current_access_level() >= 2);

create policy "compliance_rows_update_by_level"
on public.compliance_rows for update
to authenticated
using (owner_id = (select auth.uid()) or private.current_access_level() >= 2)
with check (owner_id = (select auth.uid()) or private.current_access_level() >= 2);

create policy "compliance_rows_delete_by_level"
on public.compliance_rows for delete
to authenticated
using (owner_id = (select auth.uid()) or private.current_access_level() >= 2);

revoke all on public.compliance_rows from public, anon, authenticated;
grant select, insert, update, delete on public.compliance_rows to authenticated;
grant usage, select on sequence public.compliance_rows_id_seq to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['workspace_config', 'compliance_rows'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

comment on table public.workspace_config is
  'Database-backed runtime catalogs and workspace policy; contains no customer or demo records.';
comment on table public.notification_preferences is
  'Per-user delivery preferences for durable proposal workflow notifications.';
comment on table public.compliance_rows is
  'Persisted RFP/compliance results; the application never fabricates rows when this table is empty.';

-- Legacy proposals may still attach to a real live deal through their explicit
-- opportunity ID, but approval must never synthesize a deal when no such row
-- exists. New proposals are linked to a selected deal at creation time.
create or replace function private.sync_proposal_deal_decision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  linked public.deals%rowtype;
  decision_source text;
begin
  if old.status <> 'Pending Review' or
     new.status not in ('Approved', 'Reject & Close') or
     new.status is not distinct from old.status then
    return new;
  end if;

  if actor_id is null or private.current_access_level() < 2 then
    raise exception 'A Level 2 reviewer is required for this proposal decision.'
      using errcode = '42501';
  end if;

  if new.deal_id is not null then
    select deal.*
    into linked
    from public.deals as deal
    where deal.id = new.deal_id
    for update;

    if not found then
      raise exception 'The linked deal is no longer open. Refresh the approval queue and try again.'
        using errcode = 'P0002';
    end if;

    if linked.case_id is distinct from new.case_id then
      raise exception 'This deal already has a live proposal case. Close or supersede it before attaching another.'
        using errcode = '23505';
    end if;

    new.prospect_id := coalesce(new.prospect_id, linked.prospect_id);
  else
    if nullif(pg_catalog.btrim(new.opportunity_id), '') is null then
      raise exception 'An approved or closed proposal must have a non-empty opportunity ID before it can link a deal.'
        using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.opportunity_id, 0)
    );

    select deal.*
    into linked
    from public.deals as deal
    where deal.opportunity_id = new.opportunity_id
    limit 1
    for update;

    if linked.id is null then
      raise exception 'No live deal matches this legacy proposal. Open a deal in Pipeline and create a new proposal from that deal.'
        using errcode = 'P0002';
    end if;

    if exists (
      select 1
      from public.proposals as proposal
      where proposal.deal_id = linked.id
        and proposal.case_id <> new.case_id
        and (
          proposal.status in ('Draft', 'Pending Review', 'Reject & Revise')
          or (proposal.status = 'Approved' and
              coalesce(proposal.outcome, 'Pending') = 'Pending')
        )
    ) then
      raise exception 'This deal already has a live proposal case. Close or supersede it before attaching another.'
        using errcode = '23505';
    end if;

    update public.deals
    set case_id = new.case_id,
        opportunity_id = coalesce(nullif(new.opportunity_id, ''), opportunity_id)
    where id = linked.id
    returning * into linked;

    new.deal_link_action := 'attached';
    new.deal_id := linked.id;
    new.deal_linked_at := pg_catalog.now();
    new.prospect_id := coalesce(new.prospect_id, linked.prospect_id);
  end if;

  if new.status = 'Reject & Close' then
    select config.value ->> 'proposalDecisionSource'
    into decision_source
    from public.workspace_config as config
    where config.key = 'pipeline_settings';

    if nullif(pg_catalog.btrim(decision_source), '') is null or not exists (
      select 1
      from public.workspace_config as config,
           jsonb_array_elements_text(config.value) as source(value)
      where config.key = 'deal_sources'
        and source.value = decision_source
    ) then
      raise exception 'Configure a valid proposal decision source before closing this deal.'
        using errcode = '23514';
    end if;

    new.outcome := 'Disqualified';
    perform private.archive_deal(
      linked.id,
      'Disqualified',
      new.rejection_reason,
      decision_source,
      current_date,
      actor_id,
      new.reviewer,
      new.owner_id,
      new.owner,
      coalesce(new.submitted_at, pg_catalog.now()),
      actor_id,
      new.reviewer,
      coalesce(new.reviewed_at, pg_catalog.now())
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_proposal_deal_decision()
from public, anon, authenticated;

comment on function private.sync_proposal_deal_decision() is
  'Links decisions only to persisted deals and never fabricates a deal from proposal display fields.';
