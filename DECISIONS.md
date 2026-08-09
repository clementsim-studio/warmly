# Architectural decisions

A running log of the non-obvious choices made while building Warmly, and why. Newest last (chronological). Add an entry here whenever we make a new architectural choice — not for routine bug fixes (those go in CHANGELOG.md).

---

## Shareable link is the card's raw UUID, not a slug

**Decision**: `/c/{cards.id}` — no human-readable slug layer.

**Why**: The original prototype derived a link from `recipient-occasion` (e.g. `olivia-birthday`), which collides the moment two people make a card for the same person and occasion. A UUID guarantees uniqueness with zero extra schema or logic. Confirmed with the user explicitly over a prettier-slug alternative.

## `card_objects` is one flat table for every canvas item type

**Decision**: Text notes, photos, stickers, and drawings all live in a single `card_objects` table with a `type` column and a wide set of mostly-nullable, type-specific columns, rather than one table per type.

**Why**: The frontend already models the canvas as one flat array (`objects`) — this mirrors that 1:1, needs only one Realtime subscription for the whole canvas, and avoids join complexity for what's fundamentally a single ordered collection of "things on the card."

## `card_objects.owner_id` is nullable

**Decision**: FK to `signers`, `on delete set null`, nullable.

**Why**: Cover-template pieces (title, name, motif) are communal — not attributed to one person, but still real rows anyone can drag/resize/retype. They needed an owner-less state that regular notes/photos/stickers never use.

## No accounts — local participant identity via `localStorage`

**Decision**: Each browser gets a client-generated UUID (`participant.js`) on first visit to a card, stored in `localStorage`. A `signers` row is created lazily (name starts `null`) and only gets a name once the person actually signs.

**Why**: Matches the product's explicit "no sign-ups, no accounts" pitch on the Create screen. This identity is also what `card_objects.owner_id` points to, so "mine vs. theirs" survives a refresh without any auth system.

## Signature cap enforced by a Postgres trigger, not client logic

**Decision**: `enforce_signature_cap()` fires `before insert` on `card_objects` for `type = 'text'`. Someone "counts" as signed once they have a name **and** currently have ≥1 text object on the card — recomputed live, so deleting your last note frees your seat back up (matches the original UI's dynamic count exactly). The trigger rejects the 10th+ distinct signer's first note unless `cards.unlimited` is true.

**Why**: The task explicitly required server-side enforcement. A trigger is the only place this can't be bypassed by calling the API directly (verified in testing: a direct `insert` past the client UI was rejected with `signature_cap_reached`).

## RLS is permissive; the trigger is the one hard guardrail

**Decision**: `cards`, `signers`, `card_objects` all have `select`/`insert`/`update` policies of `using (true)` / `with check (true)` for the anon role. `card_objects` also has a `delete` policy; `cards` and `signers` do not.

**Why**: There's no auth system, so there's no identity to scope RLS to beyond "you have the link." This matches the product's trust model (anyone with the link can edit) — the same boundary the original prototype had, just now backed by a real database instead of local state. The tradeoff, accepted deliberately: we can't stop a non-paying visitor from moving or deleting someone else's note at the database level the way the frontend's "full control" gate pretends to; that gate is cosmetic, same as it was in the prototype.

*(Side effect, not deliberately designed: because `cards`/`signers` have no delete policy, the client can never delete an entire card or a signer identity — only individual canvas objects. Worth knowing when cleaning up test data.)*

## Cover-template seeding is idempotent via a unique index

**Decision**: `unique index card_objects_card_cover_kind_uidx on card_objects(card_id, cover_kind)`. On conflict during first-load seeding, the losing client re-fetches the winner's rows instead of erroring.

**Why**: Found via a real race during testing — React StrictMode's dev-mode double-effect-invocation (and, more importantly, two people opening a *brand-new* link at the same real moment) could both see "no cover objects yet" and both try to seed the template, creating duplicates. `NULL` cover_kind (every ordinary note/photo/sticker) is exempt from the constraint under standard SQL NULL semantics, so this only ever constrains the template rows.

## New objects get a client-generated UUID and are added optimistically

**Decision**: Draw strokes, stickers, photos, and finished text notes all get `crypto.randomUUID()` on the client, get pushed into local state immediately, and are inserted to Supabase with that same id already set.

**Why**: Keeps interaction latency at zero (no waiting on a round trip to see your own sticker land) while making the inevitable Realtime echo of your own insert a harmless no-op merge-by-id, instead of a duplicate.

## Drag/resize/rotate: live locally, persist on release

**Decision**: Pointer-move updates during a drag only touch local React state; the DB write (and thus the Realtime broadcast to other viewers) happens once, on `pointerup`.

**Why**: Avoids flooding Postgres/Realtime with a write per animation frame while a note is being dragged, without sacrificing the instant local feedback the original prototype had.

## Photos: optimistic local preview, real upload in the background

**Decision**: On file selection, the `card_objects` row is inserted immediately with `photo_path: null`; a local `URL.createObjectURL` blob is shown while the real upload to the `card-photos` Storage bucket happens, then the row is updated with the real storage path once it completes.

**Why**: Matches the original prototype's instant "polaroid fills in" feel while doing genuine network I/O for the upload, rather than the prototype's fake in-memory base64.

## `e.preventDefault()` is required in the canvas's `pointerdown` handler

**Decision**: `onSurfaceDown` (attached to the canvas's `onPointerDown`) calls `e.preventDefault()` before doing anything else.

**Why**: Not a stylistic choice — a real, deployed bug. The canvas `<div>` isn't focusable. Creating a text note calls `.focus()` on the new `<textarea>` from a `useEffect` in response to the same click. Without `preventDefault()` on the pointerdown, the browser's own default mouseup-driven focus resolution blurs that textarea right back out (because the *original* mousedown target wasn't focusable), which immediately deleted the just-created empty note via the normal "empty note is discarded on blur" path. 100% reproducible, not a timing race. Any future code that focuses a newly-created element in response to a `pointerdown`/`mousedown` in this codebase needs the same guard.

## Deployment: Vercel + GitHub import, not Vercel CLI

**Decision**: Pushed to the existing `clementsim-studio/warmly` GitHub remote and deployed by importing that repo in the Vercel dashboard, rather than installing/authenticating the Vercel CLI.

**Why**: No Vercel CLI or stored auth token existed on the dev machine, and CLI login requires an interactive browser OAuth flow that can't be completed on the user's behalf. The dashboard-import path also matches what the user was already expecting (they anticipated setting env vars in the Vercel dashboard) and sets up continuous deployment on future pushes for free.

## `vercel.json` rewrites everything to `index.html`

**Decision**: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`.

**Why**: This is a client-side-routed SPA (React Router). Without a catch-all rewrite, Vercel's static file host 404s on a direct load or refresh of `/c/<id>` or `/share/<id>`, since those aren't real files on disk. Verified in production: a direct navigation (not client-side nav) to a `/c/<id>` URL loads the app correctly with this in place.
