-- Complete foreign-key coverage reported by the database advisor.
create index proposals_reviewer_id_idx on public.proposals(reviewer_id);
create index proposals_submitted_by_id_idx on public.proposals(submitted_by_id);

-- Supabase's documented auto-RLS event trigger remains active as postgres,
-- but it must not be callable through the public Data API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
