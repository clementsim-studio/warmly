# Changelog

Notable changes to Warmly, newest entry first. See [DECISIONS.md](./DECISIONS.md) for the reasoning behind architectural choices, not just what changed.

## 2026-08-09

### Added
- Rebuilt the local-only Warmly prototype as a real React + Vite app backed by Supabase (Postgres, Storage, Realtime), replacing fake in-memory state entirely.
- Database schema (`supabase/migrations/0001_init.sql`): `cards`, `signers`, `card_objects` tables, RLS policies, storage bucket + policies, and a trigger enforcing the 10-signature free-plan cap server-side.
- Full canvas rebuild: text notes, photos, stickers, drawings, drag/resize/rotate/zoom/pan, cover templates — matching the original prototype's design and interactions pixel-for-pixel.
- Real photo uploads to Supabase Storage (`card-photos` bucket), replacing base64-in-memory.
- Live multi-viewer sync via Supabase Realtime (`postgres_changes` on `card_objects`/`signers`/`cards`).
- Local, account-free participant identity (`localStorage`-based), replacing hardcoded sample signers.
- Upgrade flow now persists a real `unlimited` flag on the card in the database when "purchased" (payment itself intentionally stays fake — no real charge, no card validation).
- Deployed to Vercel (`https://warmly-alpha.vercel.app`), connected to GitHub for continuous deployment; added `vercel.json` SPA rewrite so `/c/:id` and `/share/:id` work on direct load/refresh.
- Initial `README.md`, `DECISIONS.md`, `CHANGELOG.md`.

### Fixed
- **Click-to-write on the canvas did nothing.** Root cause: the canvas's `pointerdown` handler focused the newly-created note's `<textarea>` without calling `preventDefault()`, so the browser's default mouseup focus resolution blurred it right back out, and the empty-note-discarded-on-blur path silently deleted it — instantly, every time. Fixed by calling `e.preventDefault()` in the canvas pointerdown handler. Reproduced live in the browser with console instrumentation before fixing, not diagnosed from reading code alone.
- A failed card-creation attempt triggered a blocking native `alert()`; replaced with an inline error message.
- Cover-template seeding could double-insert on a race (two concurrent first-loads of a brand-new card, including React StrictMode's dev-mode double-effect-invocation). Fixed with a `unique(card_id, cover_kind)` index plus client-side handling that re-fetches the winning rows on conflict instead of erroring.
- Missing baseline Postgres `GRANT`s for the `anon` role initially blocked all reads/writes even though RLS policies were correct (`permission denied for table cards`) — added explicit `grant` statements to the migration.

### Notes
- Email sending remains a fake toast placeholder (matches the payment placeholder) — explicit product decision, not yet implemented for real.
