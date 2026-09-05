# One-off operational scripts

Not part of the app or the deploy. Manual tools, run by hand against the
Supabase project. Kept in the repo so they're versioned, not lost.

| Script | What it does |
|---|---|
| `wipe_user_data.sql` | Deletes every user-generated row (`cards`, `signers`, `card_objects`, `feedback`) while preserving all schema, triggers, RLS, the Realtime publication, the Storage bucket definition, and the `pg_cron` purge schedule. Run in the Supabase SQL Editor. |
| `clear_storage.mjs` | Deletes every file in the `card-photos` Storage bucket. `TRUNCATE` never touches Storage, so this is the other half of a full wipe. Needs the service-role key. |

## Full pre-launch reset

Clears all test data before the app goes public. **Do not run either script
once real cards exist.**

1. **Storage** — from the repo root:
   ```bash
   VITE_SUPABASE_URL="https://<ref>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<service_role_key>" \
   node supabase/scripts/clear_storage.mjs
   ```
   The service-role key is in the Vercel env and the Supabase dashboard
   (Project Settings → API → `service_role`), not in the repo `.env`.

2. **Database** — paste `wipe_user_data.sql` into the Supabase SQL Editor and
   run it. The pre-flight / post-flight `SELECT`s show the row counts before
   and after.

Order doesn't matter — `clear_storage.mjs` walks the bucket directly and
needs nothing from the database.

## What is deliberately left intact

- The 15-day `purge-expired-cards` schedule (migrations `0008` / `0009`) — it
  lives in the `cron` schema and survives the wipe, so it's armed for real
  traffic straight after the reset.
- All schema, triggers, RLS policies, grants, indexes, the
  `supabase_realtime` publication, and the `card-photos` bucket row.
