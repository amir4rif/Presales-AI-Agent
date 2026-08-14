# Ramssol Pre-Sales Copilot

The migrated application is a single Next.js project rooted at `C:\RamsAI`.
The old static HTML copies have been removed, every page has its own App Router
folder, shared application logic lives in `src/lib`, and all external credentials
are read only by server modules.

```text
Browser UI ──► /api/generate ──► Anthropic
           └─► shared data API ──► /api/lark ──► Lark Base (Bitable)
```

The system is intentionally left in `DATA_SOURCE=seed` for now. In that mode it
uses mock/local data and makes no external Lark request. Entering credentials and
changing the server-side data-source flag is reserved for the final implementation
session.

## Run and verify

```bash
npm install
npm run check:env
npm run dev
```

Open <http://localhost:3000>. Do not use VS Code Live Server or port `5500`;
those serve static files and bypass the Next.js server routes.

Useful verification commands:

```bash
npm run typecheck
npm run build
npm run check
```

`npm run check:env` is offline and never prints credential values. The stricter
`npm run check:env:strict` is intended for the final connection session.

## Environment contract

Copy variable names from `.env.example` into the git-ignored `.env.local`. Never
commit `.env.local`, and never prefix a secret with `NEXT_PUBLIC_`.

| Variable | Purpose |
|---|---|
| `DATA_SOURCE` | `seed` now; change to `lark` only after the final readiness check. |
| `ANTHROPIC_API_KEY` | Server-side key used only by `/api/generate`. |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-opus-5`. |
| `ANTHROPIC_EFFORT` | Optional: `low`, `medium`, `high`, `xhigh`, or `max`. |
| `ANTHROPIC_DEFAULT_MAX_TOKENS` | Optional default response budget. |
| `ANTHROPIC_MAX_TOKENS` | Optional hard server ceiling for browser requests. |
| `ANTHROPIC_TIMEOUT_MS` | Optional server timeout. |
| `LARK_APP_ID` / `LARK_APP_SECRET` | Lark custom-app credentials used to mint a tenant token. |
| `LARK_APP_TOKEN` | Identifies the Base. |
| `LARK_TABLE_ID` | Identifies the one shared application-data table. |
| `LARK_PRIMARY_FIELD` | Optional primary-field name; normally discovered automatically. |
| `LARK_BASE_URL` | Optional; defaults to `https://open.larksuite.com`. |
| `LARK_TIMEOUT_MS` | Optional server timeout. |

`NEXT_PUBLIC_DATA_SOURCE` is accepted only as a temporary compatibility fallback.
Rename it to `DATA_SOURCE` before go-live so the mode remains runtime server
configuration rather than a build-time browser constant.

## Server boundaries

- `src/lib/server/config.ts` is the only environment-variable access layer. It
  treats blank/example placeholders as missing and exposes status without values.
- `src/app/api/generate/route.ts` validates and bounds browser input, calls the
  Anthropic SDK on the Node server, and never accepts a browser-selected model.
- `src/lib/server/lark.ts` owns tenant-token caching, timeouts, pagination, and
  batch create/update/delete calls.
- `src/app/api/lark/route.ts` is the required server-side Lark bridge. Its normal
  GET is readiness-only and does not contact Lark; `?records=1` is an explicit
  connection/read diagnostic.
- `src/app/api/data` is the shared application data layer. It hydrates all five
  collections and persists changes through the Lark bridge.

## Shared data behavior

All pages use the same functions in `src/lib/data.ts`: `getProposals`,
`getDeals`, `getClosedDeals`, `getProspects`, `getTeam`, their matching save
functions, and `stats`.

- In `seed` mode, those functions use the existing local demo store.
- In `lark` mode, `AppShell` hydrates all collections before rendering a page.
- Existing synchronous page code reads the hydrated browser cache.
- Every shared save queues a serialized server write for its collection.
- Writes are serialized per collection to prevent quick UI actions racing.
- A failed initial Lark hydration blocks the data UI instead of silently
  overwriting remote data with mock rows.

The Lark table requires only its default primary text field. Each application
item is stored as a versioned JSON envelope containing its collection, stable
key, and payload. The primary-field name is discovered through Lark field
metadata, or it can be set explicitly with `LARK_PRIMARY_FIELD`. Unrelated rows
are ignored rather than deleted.

## Project structure

```text
src/
  app/
    login/page.tsx
    dashboard/page.tsx
    prospects/page.tsx
    proposals/page.tsx
    pipeline/page.tsx
    compliance/page.tsx
    analytics/page.tsx
    admin/approvals/page.tsx
    admin/settings/page.tsx
    api/generate/route.ts
    api/lark/route.ts
    api/data/route.ts
    api/data/[collection]/route.ts
  components/
  lib/
    ai.ts
    data.ts
    data-sync.ts
    role.ts
    integrations.ts
    server/
      config.ts
      lark.ts
      data-store.ts
```

There is one `callClaude` in `src/lib/ai.ts`, one `ROLE_LEVELS` in
`src/lib/role.ts`, and one shared data contract in `src/lib/data.ts`.

## Final implementation hand-off

Follow [docs/FINAL_IMPLEMENTATION.md](docs/FINAL_IMPLEMENTATION.md). The short
version is: grant the Lark custom app access to the Base, enter the values, run
the strict offline check, test explicit diagnostics, and change
`DATA_SOURCE=lark` last.

## Known production blockers

The migration prepares integrations; it does not replace authentication.

- Accounts/passwords and sessions still live in browser storage.
- role guards are client-side only.
- server routes do not yet authenticate callers or apply per-user authorization.
- `/api/generate` needs authentication/rate limiting before public deployment.

Keep deployment private/local until those items are implemented.
