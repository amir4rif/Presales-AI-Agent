alter table public.deals
  add column if not exists stage_entered_on date;

update public.deals
set stage_entered_on = current_date - greatest(days_in_stage, 0)
where stage_entered_on is null;

alter table public.deals
  alter column stage_entered_on set default current_date,
  alter column stage_entered_on set not null;

comment on column public.deals.stage_entered_on is
  'Calendar date the deal entered its current pipeline stage; stage age is derived from this date.';

comment on column public.deals.days_in_stage is
  'Legacy compatibility value only; application stage age is derived from stage_entered_on.';
