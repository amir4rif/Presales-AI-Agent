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
- Add `RESEARCH_GEMINI_API_KEY` from a separate Gemini/Cloud project when sourced prospect research should be enabled; a second key in the generation project still shares that project's quota.
- Keep all secret/provider keys server-only.
- Run `npm run check:env:strict`; the command is offline and never prints values.

## 4. Verify authorization and concurrency

- Anonymous requests to `/api/data?all=1` return `401` in Supabase mode.
- Level 1 can read only owned proposals, deals, closed deals, prospects, and their own profile.
- Level 2 and Level 3 can read team data.
- On `deals`, `closed_deals`, and `prospects`, a Level 2 Sales Manager may create team rows and edit rows owned by any rep, but may not change an existing row's `owner_id` or its denormalized `rep` ownership label. Deal and closed-deal deletion remains owner-only below Level 3. Level 2 and 3 may delete any prospect only when it has no linked work; linked prospects are archived as `Inactive`.
- Level 3 administrators have full control over those three tables, including reassignment and deletion.
- Level 1 cannot approve, Reject & Close, or alter reviewer-controlled fields with a direct API call.
- A rep can delete only their own Draft proposal. Another rep's Draft and every submitted, approved, rejected, closed, or superseded proposal remain undeletable through direct API calls.
- Delete a Draft version 2, confirm version 1 remains in history, then create version 2 again to confirm the unique `(case_id, version)` slot was released.
- Two users editing different rows do not overwrite each other.
- A submitted proposal appears for the reviewer without a page refresh.

## 5. Click through the product workflow

1. Level 1 creates a proposal; confirm Postgres assigns its Case ID.
2. Level 1 submits it for review.
3. Level 2 rejects it with a reason.
4. Level 1 creates a new version; confirm the old version becomes Superseded and remains queryable.
5. Level 2 approves the new version.
6. Set Won/Lost outcomes on approved proposals and confirm Dashboard, Analytics, Proposals, and Approvals agree. Pending outcomes must not enter the Stage 2 denominator.
7. Exercise Gemini and confirm a forced/rate-limited `429` displays a useful message.
8. If grounded research is configured, confirm it shows a real summary, working source links, and Google's Search Suggestions; confirm `RESEARCH_GEMINI_API_KEY` never reaches the browser.

## 6. Deploy to Vercel

- Set Node.js 22 or later.
- Configure Preview and Production environment variables.
- Add deployed domains to Supabase Auth redirect URLs before testing sign-in.
- Run `npm run lint`, `npm run typecheck`, and `npm run build` against the exact deployment commit.
- Repeat the three-user workflow on the deployed URL.
