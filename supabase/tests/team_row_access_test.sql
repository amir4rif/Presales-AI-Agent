begin;
select plan(25);

insert into auth.users (id, email)
values
  ('10000000-0000-0000-0000-000000000001', 'owner@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'manager@example.test'),
  ('10000000-0000-0000-0000-000000000003', 'admin@example.test');

update public.profiles
set role = case id
    when '10000000-0000-0000-0000-000000000002' then 'Sales Manager'
    when '10000000-0000-0000-0000-000000000003' then 'Sales Operations'
    else 'Sales Representative'
  end,
  level = case id
    when '10000000-0000-0000-0000-000000000002' then 2
    when '10000000-0000-0000-0000-000000000003' then 3
    else 1
  end
where id in (
  '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000003'
);

insert into public.deals (id, owner_id, rep, account)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Owner', 'Owner deal'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Manager', 'Manager deal');

insert into public.closed_deals (id, owner_id, rep, account, close_date, outcome)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Owner', 'Owner closed deal', current_date, 'Won'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Manager', 'Manager closed deal', current_date, 'Lost');

insert into public.prospects (id, owner_id, name, opportunities)
values
  (900001, '10000000-0000-0000-0000-000000000001', 'Owner prospect', 0),
  (900002, '10000000-0000-0000-0000-000000000002', 'Manager prospect', 0),
  (900003, '10000000-0000-0000-0000-000000000001', 'Owner cleanup prospect', 0),
  (900004, '10000000-0000-0000-0000-000000000001', 'Linked prospect', 1);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000002';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';

select results_eq(
  $$select count(*) from public.deals where id = '20000000-0000-0000-0000-000000000001'$$,
  array[1::bigint],
  'Level 2 can read another rep''s deal'
);
select results_eq(
  $$select count(*) from public.closed_deals where id = '30000000-0000-0000-0000-000000000001'$$,
  array[1::bigint],
  'Level 2 can read another rep''s closed deal'
);
select results_eq(
  $$select count(*) from public.prospects where id = 900001$$,
  array[1::bigint],
  'Level 2 can read another rep''s prospect'
);

select results_eq(
  $$update public.deals set notes = 'Manager edit' where id = '20000000-0000-0000-0000-000000000001' returning notes$$,
  array['Manager edit'],
  'Level 2 can edit another rep''s deal'
);
select results_eq(
  $$update public.closed_deals set source = 'Manager edit' where id = '30000000-0000-0000-0000-000000000001' returning source$$,
  array['Manager edit'],
  'Level 2 can edit another rep''s closed deal'
);
select results_eq(
  $$update public.prospects set watched = true where id = 900001 returning watched$$,
  array[true],
  'Level 2 can edit another rep''s prospect'
);

select throws_ok(
  $$update public.deals set owner_id = '10000000-0000-0000-0000-000000000002' where id = '20000000-0000-0000-0000-000000000001'$$,
  '42501',
  'Only Level 3 administrators can reassign existing team rows.',
  'Level 2 cannot reassign another rep''s deal'
);
select throws_ok(
  $$update public.closed_deals set owner_id = '10000000-0000-0000-0000-000000000002' where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501',
  'Only Level 3 administrators can reassign existing team rows.',
  'Level 2 cannot reassign another rep''s closed deal'
);
select throws_ok(
  $$update public.prospects set owner_id = '10000000-0000-0000-0000-000000000002' where id = 900001$$,
  '42501',
  'Only Level 3 administrators can reassign existing team rows.',
  'Level 2 cannot reassign another rep''s prospect'
);
select throws_ok(
  $$update public.deals set rep = 'Manager' where id = '20000000-0000-0000-0000-000000000001'$$,
  '42501',
  'Only Level 3 administrators can reassign existing team rows.',
  'Level 2 cannot reassign a deal by changing only its rep label'
);
select throws_ok(
  $$update public.closed_deals set rep = 'Manager' where id = '30000000-0000-0000-0000-000000000001'$$,
  '42501',
  'Only Level 3 administrators can reassign existing team rows.',
  'Level 2 cannot reassign a closed deal by changing only its rep label'
);

select results_eq(
  $$delete from public.deals where id = '20000000-0000-0000-0000-000000000001' returning id::text$$,
  array[]::text[],
  'Level 2 cannot delete another rep''s deal'
);
select results_eq(
  $$delete from public.closed_deals where id = '30000000-0000-0000-0000-000000000001' returning id::text$$,
  array[]::text[],
  'Level 2 cannot delete another rep''s closed deal'
);
select results_eq(
  $$delete from public.prospects where id = 900003 returning id::text$$,
  array['900003'],
  'Level 2 can delete another rep''s unlinked prospect'
);
select throws_ok(
  $$delete from public.prospects where id = 900004$$,
  '23503',
  'Prospect "Linked prospect" has linked work and must be archived instead.',
  'Level 2 cannot delete another rep''s linked prospect'
);
select results_eq(
  $$update public.prospects set status = 'Inactive' where id = 900004 returning status$$,
  array['Inactive'],
  'Level 2 can archive another rep''s linked prospect'
);

select results_eq(
  $$delete from public.deals where id = '20000000-0000-0000-0000-000000000002' returning id::text$$,
  array['20000000-0000-0000-0000-000000000002'],
  'Level 2 can delete their own deal'
);
select results_eq(
  $$delete from public.closed_deals where id = '30000000-0000-0000-0000-000000000002' returning id::text$$,
  array['30000000-0000-0000-0000-000000000002'],
  'Level 2 can delete their own closed deal'
);
select results_eq(
  $$delete from public.prospects where id = 900002 returning id::text$$,
  array['900002'],
  'Level 2 can delete their own prospect'
);

reset role;
set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-0000-0000-000000000003';
set local "request.jwt.claims" = '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}';

select results_eq(
  $$update public.deals set owner_id = '10000000-0000-0000-0000-000000000003', rep = 'Admin' where id = '20000000-0000-0000-0000-000000000001' returning owner_id::text || ':' || rep$$,
  array['10000000-0000-0000-0000-000000000003:Admin'],
  'Level 3 can reassign a deal'
);
select results_eq(
  $$update public.closed_deals set owner_id = '10000000-0000-0000-0000-000000000003', rep = 'Admin' where id = '30000000-0000-0000-0000-000000000001' returning owner_id::text || ':' || rep$$,
  array['10000000-0000-0000-0000-000000000003:Admin'],
  'Level 3 can reassign a closed deal'
);
select results_eq(
  $$update public.prospects set owner_id = '10000000-0000-0000-0000-000000000003' where id = 900001 returning owner_id::text$$,
  array['10000000-0000-0000-0000-000000000003'],
  'Level 3 can reassign a prospect'
);

select results_eq(
  $$delete from public.deals where id = '20000000-0000-0000-0000-000000000001' returning id::text$$,
  array['20000000-0000-0000-0000-000000000001'],
  'Level 3 can delete any deal'
);
select results_eq(
  $$delete from public.closed_deals where id = '30000000-0000-0000-0000-000000000001' returning id::text$$,
  array['30000000-0000-0000-0000-000000000001'],
  'Level 3 can delete any closed deal'
);
select results_eq(
  $$delete from public.prospects where id = 900001 returning id::text$$,
  array['900001'],
  'Level 3 can delete any prospect'
);

select * from finish();
rollback;
