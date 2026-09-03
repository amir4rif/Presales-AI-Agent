-- Cover the actor foreign key so profile cleanup does not scan notifications.
create index notifications_actor_id_idx on public.notifications(actor_id);
