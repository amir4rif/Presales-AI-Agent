-- Deliver proposal workflow notifications to the recipient, not the actor's
-- browser. Rows are created in the same transaction as the proposal change,
-- so a successful submit/review always has a durable notification trail.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  proposal_id text not null references public.proposals(id) on delete cascade,
  event_type text not null check (event_type in ('approve', 'reject', 'pending')),
  title text not null,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (proposal_id, recipient_id, event_type)
);

create index notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
on public.notifications for select
to authenticated
using (recipient_id = (select auth.uid()));

create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (recipient_id = (select auth.uid()))
with check (recipient_id = (select auth.uid()));

create policy "notifications_delete_own"
on public.notifications for delete
to authenticated
using (recipient_id = (select auth.uid()));

-- New objects are deliberately not exposed by this project's default grants.
-- Recipients may read/delete their rows and may update only the read marker.
-- No client role can insert a notification or rewrite its recipient/content.
revoke all on public.notifications from public, anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function private.deliver_proposal_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  notification_type text;
  notification_title text;
  notification_body text;
begin
  -- Administrative SQL and migrations do not impersonate a product user.
  if actor is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'Pending Review' then
      notification_type := 'pending';
    end if;
  else
    if old.status is distinct from new.status then
      if new.status = 'Pending Review' then
        notification_type := 'pending';
      elsif old.status = 'Pending Review' and new.status = 'Approved' then
        notification_type := 'approve';
      elsif old.status = 'Pending Review' and
            new.status in ('Reject & Revise', 'Reject & Close') then
        notification_type := 'reject';
      end if;
    end if;
  end if;

  if notification_type is null then
    return new;
  end if;

  if notification_type = 'pending' then
    notification_title := 'Proposal submitted for review';
    notification_body := format(
      '%s — %s%s',
      new.company,
      new.case_id,
      case when new.version > 1 then format(' (v%s)', new.version) else '' end
    );

    insert into public.notifications (
      recipient_id, actor_id, proposal_id, event_type, title, body
    )
    select
      profile.id,
      actor,
      new.id,
      notification_type,
      notification_title,
      notification_body
    from public.profiles as profile
    where profile.status = 'active'
      and profile.level >= 2
      and profile.id is distinct from actor
    on conflict (proposal_id, recipient_id, event_type) do nothing;
  else
    notification_title := case notification_type
      when 'approve' then 'Proposal approved'
      else case new.status
        when 'Reject & Close' then 'Proposal rejected & closed'
        else 'Proposal sent back for revision'
      end
    end;
    notification_body := format(
      '%s — %s%s',
      new.company,
      new.case_id,
      case
        when notification_type = 'reject' and new.rejection_reason <> ''
          then format(' — Reason: %s', new.rejection_reason)
        else ''
      end
    );

    if new.owner_id is distinct from actor then
      insert into public.notifications (
        recipient_id, actor_id, proposal_id, event_type, title, body
      ) values (
        new.owner_id,
        actor,
        new.id,
        notification_type,
        notification_title,
        notification_body
      )
      on conflict (proposal_id, recipient_id, event_type) do nothing;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.deliver_proposal_notification()
  from public, anon, authenticated;

create trigger proposals_deliver_recipient_notification
after insert or update of status on public.proposals
for each row execute function private.deliver_proposal_notification();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

comment on table public.notifications is
  'Durable, recipient-scoped proposal workflow notifications.';
