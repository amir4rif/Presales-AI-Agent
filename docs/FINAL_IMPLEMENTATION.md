# Final implementation checklist

This checklist is intentionally split into an offline preparation gate and an
explicit connection gate. Do not switch the data source until the earlier checks
pass.

## 1. Keep the current system offline

- Confirm `.env.local` remains git-ignored.
- Keep `DATA_SOURCE=seed`.
- Run `npm run check`, then manually exercise the mock-data pages.
- Confirm Administration → Integrations says “Prepared — seed mode active.”

Neither the normal Lark status route nor `npm run check:env` contacts Lark.

## 2. Prepare Lark outside the app

1. Create or select a Lark custom app.
2. Grant it Base/Bitable metadata-read and record read/write permissions.
3. Publish/install the app for the tenant as required by the tenant policy.
4. Add the app as a collaborator/data-access principal on the target Base.
5. Create/select one Base table. Its normal primary text field is sufficient.
6. Record the App ID, App Secret, Base app token, and table ID.

The app token is the identifier after `/base/` in a normal Base URL. The table
ID is the `table` value/identifier for the selected table; do not confuse the two.

## 3. Enter server-only values

Populate these in `.env.local` without quotes unless the value itself requires
them:

```dotenv
DATA_SOURCE=seed

ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-opus-5
ANTHROPIC_EFFORT=medium

LARK_APP_ID=...
LARK_APP_SECRET=...
LARK_APP_TOKEN=...
LARK_TABLE_ID=...
```

Leave `LARK_PRIMARY_FIELD` blank to auto-discover the default primary field.
Set it only if the tenant blocks field-metadata discovery or the wrong field is
selected.

Restart the Next.js server after any `.env.local` change.

## 4. Run the offline gate

```bash
npm run check:env:strict
npm run typecheck
npm run build
```

The environment checker reports variable names only, never values, and makes no
network request.

## 5. Explicitly test connections

With the app still in `seed` mode:

1. Open `GET /api/generate`; it should report `configured: true`.
2. Trigger one low-risk AI feature and confirm a response.
3. Open `GET /api/lark`; it should report `ready: true`.
4. Explicitly open `GET /api/lark?records=1`; this is the first Lark network
   diagnostic and should return a record count.

Status “configured/ready” means required values are present. It deliberately
does not claim network connectivity until an explicit operation succeeds.

## 6. Activate Lark last

1. Stop the dev server.
2. Change `DATA_SOURCE=lark`.
3. Restart the server and sign in.
4. AppShell will hydrate proposals, deals, closed deals, prospects, and team data
   before rendering any page.
5. If the Lark table is empty, the app correctly starts with empty collections;
   it does not inject mock records.
6. Create one disposable test record in each workflow and verify its Lark row.
7. Remove the disposable records through the UI.

If hydration fails, the app displays a blocking retry screen. Switch back to
`DATA_SOURCE=seed` to return to demo mode without attempting a Lark write.

## 7. Before public deployment

Do not expose these routes publicly until real authentication, server-side role
authorization, rate limiting, and audit logging are in place. Browser-storage
accounts and client-only role guards are demo behavior, not production security.
