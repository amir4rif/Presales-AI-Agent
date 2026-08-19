# Free-tier implementation hand-off

Use this checklist only after the correct Supabase project, Gemini key, and Vercel account are available. Never paste secret values into issues, commits, or chat logs.

## 1. Connect the intended Supabase project

- Confirm the project name is **Ramssol Pre-Sales Copilot**.
- Confirm the project reference before applying any migration.
- Apply all files in `supabase/migrations/` in filename order.
- Generate fresh TypeScript types from that project and compare them with `src/lib/supabase/database.types.ts`.
- Run Supabase security and performance advisors and resolve every material warning.
- Verify that `public.proposals` appears in the `supabase_realtime` publication.

## 2. Configure Auth

- Add local, Vercel Preview, and Vercel Production URLs to Auth URL Configuration.
- Decide whether email confirmation stays enabled. New free-tier projects using default SMTP cannot customize the built-in email templates.
- Create three real users through the application.
- Use the Supabase SQL Editor once to promote the intended first administrator profile to `role = 'Sales Operations', level = 3`; then assign the reviewer account from Settings.
- Never derive a role or access level from `raw_user_meta_data`.

## 3. Configure server integrations

- Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Add `GEMINI_API_KEY`; keep `AI_PROVIDER=gemini`.
- Optionally add `SERPAPI_API_KEY` for sourced prospect research.
- Keep all secret/provider keys server-only.
- Run `npm run check:env:strict`; the command is offline and never prints values.

## 4. Verify authorization and concurrency

- Anonymous requests to `/api/data?all=1` return `401` in Supabase mode.
- Level 1 can read only owned proposals, deals, closed deals, prospects, and their own profile.
- Level 2 and Level 3 can read team data.
- Level 1 cannot approve, Reject & Close, or alter reviewer-controlled fields with a direct API call.
- A proposal cannot be deleted, including through a direct API call.
- Two users editing different rows do not overwrite each other.
- A submitted proposal appears for the reviewer without a page refresh.

## 5. Click through the product workflow

1. Level 1 creates a proposal; confirm Postgres assigns its Case ID.
2. Level 1 submits it for review.
3. Level 2 rejects it with a reason.
4. Level 1 creates a new version; confirm the old version becomes Superseded and remains queryable.
5. Level 2 approves the new version.
6. Confirm Dashboard, Analytics, Proposals, and Approvals agree.
7. Exercise Gemini and confirm a forced/rate-limited `429` displays a useful message.
8. If SerpApi is configured, confirm research shows source links and its key never reaches the browser.

## 6. Deploy to Vercel

- Set Node.js 22 or later.
- Configure Preview and Production environment variables.
- Add deployed domains to Supabase Auth redirect URLs before testing sign-in.
- Run `npm run lint`, `npm run typecheck`, and `npm run build` against the exact deployment commit.
- Repeat the three-user workflow on the deployed URL.
