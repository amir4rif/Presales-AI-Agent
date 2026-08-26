-- Restore the Data API surface that 20260819084855 intended but never achieved.
--
-- That migration documented the intent in its own comment -- "These grants opt
-- authenticated users into the Data API; RLS still controls rows" -- and aimed for:
--
--   profiles      authenticated: select, update
--   proposals     authenticated: select, insert, update   (never delete: versions are permanent)
--   deals         authenticated: select, insert, update, delete
--   closed_deals  authenticated: select, insert, update, delete
--   prospects     authenticated: select, insert, update, delete
--   the 3 views   authenticated: select
--   anon          nothing, anywhere
--
-- It did not land, because this project's default privileges (pg_default_acl,
-- schema public, grantor postgres) hand out arwdDxtm on every new table and
-- view, and rwU on every new sequence, to anon, authenticated and service_role.
-- Every object was therefore born holding ALL privileges, which made the
-- migration's `grant select, insert, update ...` lines no-ops layered on top of
-- a wider grant. Its `revoke all ... from anon` listed only the five tables, so
-- what actually shipped was:
--
--   * anon still holds ALL on my_proposals, admin_approvals and
--     proposal_version_history, plus rwU on all three sequences.
--   * authenticated still holds ALL on all five tables, including delete on
--     proposals and insert/delete on profiles, both deliberately withheld.
--
-- None of this is currently reachable. The three views are security_invoker, so
-- they are evaluated with the caller's own rights against base tables anon has
-- no privilege on; and proposals has no delete policy while profiles has no
-- insert or delete policy, so RLS refuses those writes whatever the grant says.
-- The grants are the second line of defence that is supposed to still hold if a
-- policy is ever added or relaxed, so they are worth making true.

-- 1. anon gets nothing through the Data API.
revoke all on public.profiles, public.proposals, public.deals,
  public.closed_deals, public.prospects from anon;
revoke all on public.my_proposals, public.admin_approvals,
  public.proposal_version_history from anon;
revoke all on sequence public.proposal_number_seq, public.case_number_seq,
  public.prospects_id_seq from anon;

-- 2. Reset authenticated, then re-grant exactly the intended set.
revoke all on public.profiles, public.proposals, public.deals,
  public.closed_deals, public.prospects from authenticated;
revoke all on public.my_proposals, public.admin_approvals,
  public.proposal_version_history from authenticated;
revoke all on sequence public.proposal_number_seq, public.case_number_seq,
  public.prospects_id_seq from authenticated;

grant select, update on public.profiles to authenticated;
grant select, insert, update on public.proposals to authenticated;
grant select, insert, update, delete on public.deals,
  public.closed_deals, public.prospects to authenticated;
grant select on public.my_proposals, public.admin_approvals,
  public.proposal_version_history to authenticated;
-- usage is what nextval() needs; the sequences back proposals.id and case_id
-- through private.next_proposal_id() / next_case_id(), which are security invoker.
grant usage, select on sequence public.proposal_number_seq,
  public.case_number_seq, public.prospects_id_seq to authenticated;

-- 3. Stop the next object from being born with ALL privileges again.
--
--    DELIBERATE POSTURE CHANGE: after this, a new table, view or sequence
--    created in public by postgres is NOT reachable through the Data API until
--    it is granted explicitly. That is precisely what 20260819084855 already
--    assumed to be true, and it is the behaviour of newer Supabase projects.
--    service_role is left untouched -- it is the trusted backend role and it
--    bypasses RLS by design. Function defaults are left untouched as well,
--    since Supabase's own tooling relies on them.
alter default privileges in schema public
  revoke all on tables from anon, authenticated;
alter default privileges in schema public
  revoke all on sequences from anon, authenticated;
