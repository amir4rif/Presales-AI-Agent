-- Drafts have never entered the approval-rate denominator, so their owner may
-- remove an accidental version. Submitted and reviewed versions remain
-- permanent because this policy is the sole DELETE policy on proposals.
create policy "proposals_delete_own_draft"
on public.proposals for delete
to authenticated
using (owner_id = (select auth.uid()) and status = 'Draft');

-- Table privileges and RLS are separate gates in the Supabase Data API.
grant delete on public.proposals to authenticated;
