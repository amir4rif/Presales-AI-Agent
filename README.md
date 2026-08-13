# Ramssol Pre-Sales Copilot — Next.js

This repository has one application root: `C:\RamsAI`. Run every app
command from that directory. The former root-level static HTML demo and
the nested `presales-ai-agent` copy have been removed.

The browser-only HTML demo, restructured so it can take a real company
API key. The key now lives on the server; the browser calls our own
endpoint and never sees a credential.

```
Browser  ──►  /api/generate  ──►  api.anthropic.com
         ──►  /api/lark      ──►  Lark Base (Bitable)
```

## Getting started

```bash
npm install
npm run dev
```

Do not use VS Code Live Server or port `5500`; that serves static HTML and
is not part of this Next.js application. In VS Code, run the
`Run Ramssol Pre-Sales` launch configuration instead.

Then open <http://localhost:3000>. You will be sent to `/login` — create
an account to get in (the role you pick sets your access level).

## Environment

Everything secret goes in `.env.local`, which is git-ignored. **Nothing
here is prefixed `NEXT_PUBLIC_`, so none of it is bundled into the
browser.**

| Variable | Used by | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | `api/generate` | Required for any AI feature. |
| `ANTHROPIC_MODEL` | `api/generate` | Optional. Defaults to `claude-opus-5`. |
| `ANTHROPIC_EFFORT` | `api/generate` | Optional reasoning depth: `low`–`max`. Defaults to `medium`. |
| `LARK_APP_ID` / `LARK_APP_SECRET` | `api/lark` | Mints the tenant access token. |
| `LARK_APP_TOKEN` | `api/lark` | Identifies the Base. |
| `LARK_TABLE_ID` | `api/lark` | Optional default table. |
| `LARK_BASE_URL` | `api/lark` | Optional. `https://open.larksuite.com` (Lark) or `https://open.feishu.cn` (Feishu). |
| `NEXT_PUBLIC_DATA_SOURCE` | `lib/data` | `seed` (demo data) or `lark`. Keep on `seed` until the credentials arrive. |

Restart the dev server after editing `.env.local` — Next reads it at boot.

Administration → Integrations reports whether each one is wired up. It
asks the server, so it can show status without the value ever crossing
into the browser.

## Structure

```
src/
  app/
    layout.tsx              shell + sidebar (replaces app-shell.js)
    page.tsx                "/" — redirect by level
    login/page.tsx
    dashboard/page.tsx      one page, renders L1/L2/L3 by level
    prospects/page.tsx
    compliance/page.tsx
    proposals/page.tsx
    admin/approvals/page.tsx    level 2+
    admin/settings/page.tsx     level 3
    analytics/page.tsx          level 2+
    pipeline/page.tsx
    api/generate/route.ts   calls Claude, key lives here
    api/lark/route.ts       reads/writes Lark Base, token lives here
    styles.css              the original stylesheet, plus the per-page
                            <style> blocks appended at the bottom
  components/
    AppShell.tsx            auth guard + layout runtime
    Sidebar.tsx
    RequireLevel.tsx        wrapper, replaces the PAGE_LEVELS check
    Topbar.tsx / Modal.tsx / Toast.tsx / GalaxyTransition.tsx
    dashboard/              LevelOne / LevelTwo / LevelThree
    prospects/              AddProspectModal / ProspectDetail
  lib/
    role.ts                 ROLE_LEVELS, currentLevel — one definition
    data.ts                 app-data.js, same function names
    ai.ts                   callClaude, one copy instead of eight
    docTemplates.ts         report + proposal-deck HTML builders
    docExport.ts            PDF / Word download helpers
    nav.ts, notify.ts, useStats.ts, useIntegrations.ts
```

## Swapping the data source to Lark

`lib/data.ts` exposes the accessors every page uses — `getProposals`,
`getDeals`, `getClosedDeals`, `getProspects`, `getTeam`, `stats`. They
read localStorage today. To move a table to Lark, change the body of its
accessor to call `/api/lark`; the pages do not change, because the
function names and shapes stay the same. Do it one table at a time.

## Still open (deliberately not in this round)

- **Passwords are stored in plain text in localStorage.** `login/page.tsx`
  compares `account.password === password`. This needs a real auth
  backend.
- **The level check is client-side only.** `RequireLevel` stops the nav,
  not a determined user. Real enforcement needs the level checked on the
  server once auth moves off localStorage.
- **`/api/generate` has no caller authentication.** Anyone who can reach
  the deployed app can spend the company key. Fine on localhost; put auth
  or rate limiting in front of it before this is exposed publicly.
