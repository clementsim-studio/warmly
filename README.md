# Warmly

A digital group card app: one shareable link, multiple people add a note, photo, sticker, or drawing to a card in real time. No accounts, no sign-ups.

Live at: https://warmly-alpha.vercel.app

## Stack

- **Frontend**: React 18 + Vite, React Router (client-side routing)
- **Backend**: Supabase — Postgres (data), Storage (photo uploads), Realtime (live sync via `postgres_changes`)
- **Styling**: plain CSS, no framework (design tokens in `src/styles.css`)
- **PDF export**: `jspdf` + `html2canvas` (client-side only — rasterizes each face, assembles a real two-page PDF)
- **Hosting**: Vercel (static build + SPA rewrite)

No server code of our own — the browser talks to Supabase directly with the anon/publishable key. The signature cap is the one thing that can't be bypassed from the client; see [DECISIONS.md](./DECISIONS.md).

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
supabase/
  migrations/0001_init.sql   Full schema: tables, RLS policies, signature-cap
                              trigger, storage bucket + policies
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

These are safe to expose client-side (that's what the anon/publishable key is for) — but still keep `.env` out of git (it already is, via `.gitignore`) and set them via your host's environment variable UI in production, not hardcoded.

## Deploying

Hosted on Vercel, connected to the `clementsim-studio/warmly` GitHub repo. Framework preset auto-detects as Vite (`npm run build`, output `dist`). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Environment Variables in the Vercel project before deploying. `vercel.json` handles the SPA rewrite; no other config needed.

## What's real vs. placeholder

- **Real**: card persistence, live multi-viewer sync, photo uploads, server-enforced 10-signature free-plan cap.
- **Placeholder (by design)**: payment ("Upgrade" flow takes no real card details, but *does* persist `unlimited: true` to the database) and email sending (shows a toast, sends nothing).

## Known limitations

- RLS is permissive (anyone holding a card's link can read/write it) — this matches the no-accounts product design; see DECISIONS.md.
- `cards` and `signers` rows can't be deleted via the anon key (no DELETE policy on those tables) — only `card_objects` rows can be removed by the client. This is incidental (not a deliberate feature) but worth knowing if you're cleaning up test data — you'll need SQL Editor access for those two tables.
