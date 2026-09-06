# Warmly

A digital group card app: one shareable link, multiple people add a note, photo, sticker, or drawing to a card in real time. No accounts, no sign-ups.

Live at: https://warmly-alpha.vercel.app

## Stack

- **Frontend**: React 18 + Vite, React Router (client-side routing)
- **Backend**: Supabase — Postgres (data), Storage (photo uploads), Realtime (live sync via `postgres_changes`)
- **Styling**: plain CSS, no framework (design tokens in `src/styles.css`)
- **PDF export**: `jspdf` + `html2canvas` (client-side only — rasterizes each face, assembles a real two-page PDF)
- **Hosting**: Vercel (static build + SPA rewrite)
- **Server code**: one Vercel serverless function, `api/feedback.js` — the only write path for the `feedback` table (see below)

The browser talks to Supabase directly with the anon/publishable key for every table except `feedback`, which has no client-facing RLS policies at all and can only be written through `api/feedback.js` (it needs the real request IP and Vercel's geo headers, neither of which exist client-side). The signature cap, the 14-day lifespan, and the daily card-creation limit are all enforced by Postgres triggers that can't be bypassed from the client; see [DECISIONS.md](./DECISIONS.md).

`api/feedback.js` needs two server-only environment variables set in Vercel (not prefixed `VITE_`, so they never reach the browser bundle) — see `.env.example`: `SUPABASE_SERVICE_ROLE_KEY` and `IP_HASH_SALT`.

## Project structure

```
src/
  CreateScreen.jsx    "Start a card" form → creates a cards row
  ShareScreen.jsx     Shows the shareable link after creation
  CardScreen.jsx      The card canvas: notes, photos, stickers, drawing,
                       signing, realtime sync, upgrade/send/print flows
  ObjectView.jsx       Renders one canvas object from a prepared descriptor
  lib/
    supabase.js        Supabase client (reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
    cardData.js         All CRUD + realtime subscription + Storage upload calls
    participant.js      Local (localStorage) "who am I on this card" identity
    canvasHtml.js        Cover-template seeding + static HTML rendering (used for
                         the print/preview mock and PDF export)
    stickers.js          Sticker SVGs + cover color palette
api/
  feedback.js            Serverless function: the one write path for the feedback table
supabase/
  migrations/0001_init.sql   Full schema: tables, RLS policies, signature-cap
                              trigger, storage bucket + policies
  migrations/0002-0009      Later schema changes — see each file's own comment
  functions/
    purge-expired-cards/    Scheduled Edge Function: hard-deletes cards (+ their
                             Storage photos) 15 days after creation
  scripts/                 One-off ops tools (pre-launch data wipe) — see
                             supabase/scripts/README.md; not part of the app
vercel.json             SPA rewrite so /c/:id and /share/:id don't 404 on reload
```

## Running locally

```bash
npm install
cp .env.example .env   # fill in your Supabase project URL + anon key
npm run dev
```

The dev server runs at `http://localhost:5173`.

### Database setup

The anon key can't run schema migrations. In the Supabase SQL Editor for your project, run:

```
supabase/migrations/0001_init.sql
```

This creates `cards`, `signers`, `card_objects`, RLS policies, the signature-cap trigger, and the `card-photos` storage bucket. It's idempotent-ish (`create ... if not exists` / `on conflict`) except for the `create policy` statements, which will error if run twice — if you need to re-run part of it, do so selectively.

### Environment variables

| Variable | Where it's used |
|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.js` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.js` |
| `VITE_GA4_MEASUREMENT_ID` | `src/lib/analytics.js` — optional; analytics load only when set **and** the build is production |

These are safe to expose client-side (that's what the anon/publishable key is for) — but still keep `.env` out of git (it already is, via `.gitignore`) and set them via your host's environment variable UI in production, not hardcoded.

## Analytics

GA4 (`src/lib/analytics.js`), loaded only in production and only when `VITE_GA4_MEASUREMENT_ID` is set — `gtag.js` is injected async so it never blocks first paint. Consent Mode v2 defaults to **denied** for all storage (there's no consent banner yet), so GA4 runs cookieless and models the gaps. Four custom events — `card_created`, `card_shared`, `card_signed`, `feedback_submitted` — fire at their success points; params are limited to non-PII (`occasion`, `format`, `method`, `location`, `rating`) and the card UUID is stripped from `page_location`/`page_path` on every hit. See DECISIONS.md ("GA4 analytics") for the full list of what is and isn't tracked, and register the event params as custom dimensions in the GA4 UI to see them in reports.

## Deploying

Hosted on Vercel, connected to the `clementsim-studio/warmly` GitHub repo. Framework preset auto-detects as Vite (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Environment Variables in the Vercel project before deploying. `vercel.json` handles the SPA rewrite; no other config needed.

## Scheduled jobs

**`purge-expired-cards`** — a Supabase Edge Function that permanently deletes each card 15 days after it was created (it's already frozen/read-only at 14 days by a DB trigger). It removes the card's photos from the `card-photos` bucket, then deletes the `cards` row; `ON DELETE CASCADE` clears its `signers` and `card_objects`. `feedback` rows are kept — their `card_id`/`signer_id` are set to null, and `card_occasion`/`card_format` are frozen onto each row at submission time for analytics. **This is a hard, irreversible delete**; the card's link 404s afterwards.

One-time setup (not covered by a Vercel deploy — Supabase-side):

1. `supabase functions deploy purge-expired-cards` (JWT verification left on).
2. Run migration `0008_feedback_survives_card_purge.sql` in the SQL Editor.
3. Store two Vault secrets, then run migration `0009_schedule_purge_expired_cards.sql`:
   ```sql
   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
   select vault.create_secret('<service-role-key>',                'service_role_key');
   ```
   Migration `0009` has the full prerequisite list and the queries to inspect `cron.job_run_details` afterwards.

The function reads Supabase's auto-injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — no manual function env vars.

## What's real vs. placeholder

- **Real**: card persistence, live multi-viewer sync, photo uploads, server-enforced 10-signature free-plan cap.
- **Placeholder (by design)**: payment ("Upgrade" flow takes no real card details, but *does* persist `unlimited: true` to the database) and email sending (shows a toast, sends nothing).

## Known limitations

- RLS is permissive (anyone holding a card's link can read/write it) — this matches the no-accounts product design; see DECISIONS.md.
- `cards` and `signers` rows can't be deleted via the anon key (no DELETE policy on those tables) — only `card_objects` rows can be removed by the client. This is incidental (not a deliberate feature) but worth knowing if you're cleaning up test data — you'll need SQL Editor access for those two tables. (The `purge-expired-cards` job deletes them server-side with the service-role key; that's a separate path from the anon client.)
