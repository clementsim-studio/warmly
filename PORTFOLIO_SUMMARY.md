# Warmly — Technical Overview

Warmly is a shareable digital group card: one link, no accounts, and anyone holding it can add a note, photo, sticker, or drawing to a card that updates live for everyone else looking at it. This document covers the architecture, the database design and its rationale, the trust model, the hardest bugs encountered while building it, and the trade-offs made deliberately rather than by accident.

It started life as an interactive prototype built in Claude Design (project: **Collaborative Card**) — a fully client-side mock with hardcoded sample signers, base64-in-memory photos, and a fake email toast. This document describes the real, production implementation that replaced it: a React app backed by a real Postgres database, with live multi-viewer sync and server-enforced business rules.

## Architecture

**Frontend**: React 18 + Vite, React Router for client-side routing. No CSS framework — hand-written design tokens in `src/styles.css`. No state management library — plain `useState`/`useReducer`/`useRef` inside one large component per screen.

**Backend**: Supabase — Postgres for data, Storage for photo uploads, Realtime for live sync (`postgres_changes` over a WebSocket). There is no backend of our own: the browser talks to Supabase directly using the anon/publishable key, and every business rule that must be trustworthy (the signature cap) is enforced inside Postgres itself via a trigger, not in application code that a client could bypass.

**Hosting**: Vercel, connected to GitHub for continuous deployment on push to `main`. `vercel.json` rewrites every path to `index.html` — required because this is a client-side-routed SPA, and without the rewrite a direct load or refresh of `/c/<id>` 404s (there's no real file at that path; React Router only handles it after the JS bundle loads).

**Code layout** (`src/`, ~4,225 lines total):

| File | Lines | Responsibility |
|---|---|---|
| `CreateScreen.jsx` | 226 | "Start a card" form → inserts a `cards` row |
| `ShareScreen.jsx` | 158 | Shows the link after creation |
| `CardScreen.jsx` | 1,665 | The canvas app: notes, photos, stickers, drawing, gestures, signing, realtime sync, cover templates, upgrade/send/print flows — deliberately one large component, mirroring the single-screen interaction model of the original prototype |
| `ObjectView.jsx` | 165 | Presentational: renders one canvas object from a pre-built style/handler descriptor |
| `lib/cardData.js` | 132 | Every Supabase call: CRUD, Storage upload, Realtime subscription |
| `lib/participant.js` | 30 | Local (no-account) identity, stored in `localStorage` |
| `lib/canvasHtml.js` | 138 | Cover-template seeding + static HTML rendering (shared by the live canvas, the "Preview & send" mock, and PDF export) |
| `lib/stickers.js` | 21 | Sticker SVGs + cover color palette |

`CardScreen.jsx` being 1,665 lines in one file is a real trade-off, not an oversight — see [Deliberate trade-offs](#deliberate-trade-offs).

## Database schema

Full definition: `supabase/migrations/0001_init.sql`. Three tables.

### `cards`

One row per card: `recipient`, `occasion` (`birthday`/`farewell`), `format` (`landscape`/`portrait`, fixed at creation), `cover_color`, `cover_motif`, `cover_layout`, and `unlimited` (the paid-plan flag). The primary key, a `uuid`, **is** the shareable link (`/c/{id}`) — there's no separate slug. A slug derived from `recipient-occasion` (what the original prototype used, purely cosmetically) can collide the moment two people make a card for the same person and occasion; a UUID can't.

### `signers`

One row per participant on a card: `id` (a client-generated UUID, see [Trust model](#trust-and-security-model)), `card_id`, `name` (nullable — null until they actually sign), `color`. This table doubles as both "who's on this card" and the join target for `card_objects.owner_id`.

### `card_objects`

Every note, photo, sticker, and drawing, in one flat table (`supabase/migrations/0001_init.sql:44-82`) discriminated by a `type` column, rather than one table per type. This mirrors how the frontend already modeled the canvas — a single array (`objects` in `CardScreen.jsx`) — so the mapping between the two is 1:1, it needs exactly one Realtime subscription for the entire canvas, and it avoids join complexity for what is fundamentally one ordered collection of "things on the card." The cost is a wide, mostly-nullable column set: `text`/`color`/`font`/`fsize`/`weight`/`align` for text (the last three only used by cover-template pieces, which are draggable/resizable/editable like any other object, not just static decoration), `kind` for stickers, `photo_path`/`caption`/`tint` for photos, `path_data`/`stroke_width`/`width`/`height` for drawings (with `width`/`height` doing double duty as the cover-template text box size).

`owner_id` is nullable (`references signers(id) on delete set null`) specifically because cover-template pieces (title, name, motif) are communal — draggable and editable by anyone, not attributed to one person.

Two indexes worth calling out beyond the obvious `card_id` ones:

- **`card_objects_card_cover_kind_uidx`**, a `unique index on (card_id, cover_kind)` — added after a real race condition was found in testing (see [Trickiest bugs](#trickiest-bugs-and-their-root-causes)). `NULL cover_kind` (every ordinary note/photo/sticker/drawing) is exempt from the constraint under standard SQL NULL semantics, so it only constrains the template rows.
- A `before update` trigger (`card_objects_set_updated_at`) that stamps `updated_at`, used only informationally — no code currently reads it for conflict resolution.

## Trust and security model

**There are no user accounts.** Identity is a random UUID generated client-side on first visit to a card and stored in `localStorage` (`lib/participant.js:9-24`) — this is what `card_objects.owner_id` and `signers.id` point to. It survives a refresh (so "mine vs. theirs" persists) but not a different browser or a cleared `localStorage`. This isn't a security shortcut so much as the explicit product design inherited from the prototype: the Create screen's own copy says "No sign-ups, no chasing."

**RLS is deliberately permissive.** Every table has `select`/`insert`/`update` policies of `using (true)` / `with check (true)` for the anon role (`0001_init.sql:179-190`); `card_objects` additionally has a `delete` policy that `cards` and `signers` do not. There's no identity to scope RLS to beyond "you have the link" — matching the trust boundary the original client-only prototype already had, just now backed by a real database that anyone with the URL can genuinely read and write via the Supabase REST API directly, not only through the app's UI.

One consequence worth being explicit about, because it's incidental rather than designed: since `cards` and `signers` have no `delete` policy, the client can never delete an entire card or a signer identity — only individual `card_objects` rows. This was discovered, not planned, while cleaning up test data during development (confirmed directly: `DELETE` requests against `cards`/`signers` return success with zero rows affected, silently no-op'd by RLS).

**The one rule that's actually enforced, not just assumed**: the 10-signature free-plan cap. `enforce_signature_cap()` (`0001_init.sql:118-155`) is a `before insert` trigger on `card_objects`. Someone "counts" as signed once they have a name **and** currently have at least one `type='text'` row on the card — recomputed live on every insert, so deleting your last note frees your seat back up, matching the original prototype's dynamic on-screen count exactly. On a new text insert, if the owner isn't already among the counted signers and the count is already at 10 (and `cards.unlimited` is false), the insert is rejected with `signature_cap_reached`. This was verified directly, not just written and trusted: a script inserted 10 real signers with notes, then attempted an 11th **by calling the Supabase REST API directly**, bypassing the UI entirely — the insert was rejected server-side (`lib/cardData.js:54-56` — `isCapRejection` — is how the client recognizes and handles that rejection gracefully, showing the upgrade modal instead of a raw error).

Everything else the UI implies about permissions — e.g. that only an "unlimited" card owner with "full control" toggled on can rearrange someone else's note (`CardScreen.jsx`, the `startMove`/`confirmControl` flow) — is a client-side courtesy, not a server-enforced rule. It can't be, without real accounts. This mirrors the original prototype's own trust model exactly; it was not weakened in the rebuild.

## Trickiest bugs and their root causes

Three bugs were serious enough to require live browser debugging (reproducing in an actual running instance, not just reading code) to root-cause. All three are documented in more detail in `DECISIONS.md` and `CHANGELOG.md`; summarized here with the actual mechanism.

### 1. Clicking the canvas silently did nothing

**Symptom**: with the Write tool active, clicking anywhere on the card produced no text box — no error, no visual feedback, nothing.

**Root cause**: it was working, faster than the eye could see. `createText` (`CardScreen.jsx:441`) does create the note and append it to state; a `useEffect` (`CardScreen.jsx:354-363`) then calls `.focus()` on the new `<textarea>`. But the click handler is bound to `onPointerDown` on a plain, non-focusable `<div>`, and it never called `preventDefault()`. Without that, the browser's own default mouseup-driven focus resolution — which runs *after* React's synchronous state update and effect — blurs whatever got focused in the meantime, because the *original* mousedown target wasn't a focusable element. That blur fires `onTextBlur`, which runs `finishText` (`CardScreen.jsx:472`), which discards any note whose text is still empty. Net effect: create, focus, instantly un-focus, instantly delete — every single time, deterministically, not a race.

This was confirmed live, not inferred: a temporary `setObjects` wrapper logged every call with a stack trace, which showed `finishText` firing via `d.onTextBlur` in the same tick as the just-completed `createText`. **Fix**: one line, `e.preventDefault()` at the top of `onSurfaceDown` (`CardScreen.jsx:548-554`).

### 2. Cover-template seeding could double-insert

**Symptom**: a freshly created card occasionally ended up with duplicate title/name/motif pieces on its cover.

**Root cause**: the first-load effect (`CardScreen.jsx:86-154`) checks whether any `card_objects` row has a non-null `cover_kind`; if not, it seeds the cover template. Two concurrent first-loads of the *same brand-new card* — either two people opening a just-created link at nearly the same moment, or, in development, React StrictMode's deliberate double-invocation of effects — can both observe "no cover objects yet" before either has finished inserting, and both seed a full template.

**Fix**: `card_objects_card_cover_kind_uidx`, a `unique(card_id, cover_kind)` index. The losing insert now fails with a Postgres `23505` (`lib/cardData.js:60-62`, `isCoverSeedRace`), and the client re-fetches the winner's already-committed rows instead of erroring — so the loser's UI still ends up correct.

### 3. PDF export produced a completely blank page

**Symptom**: "Download as PDF" opened the print dialog, but every exported page was empty — just the background color, no card content.

**Root cause**: not a rendering-engine limitation, not a JS error (confirmed — `downloadPdf()` runs with zero console errors, `CardScreen.jsx:798`), and not missing content (confirmed — the injected `dangerouslySetInnerHTML` string was measured at over 1,000 characters, real card content). It was a DOM structure bug: the print-only markup (`[data-print-doc]`) was nested **inside** the main app wrapper (`[data-app]`), and `src/styles.css`'s `@media print` block sets `[data-app] { display: none }` to hide the live app while printing. A `display:none` ancestor removes its entire subtree from rendering — a descendant's own `display: block !important` cannot override an ancestor's `display:none`; that's not a specificity contest, it's how the CSS box tree works. So the print content was structurally guaranteed to be blank, regardless of anything set on it directly.

Confirmed two independent ways before fixing: (a) forcing the print CSS onto the page without opening the native print dialog produced a visibly blank page, and walking the DOM ancestor chain from the print content found `[data-app]` — not `[data-print-doc]` — as the `display:none` node; (b) the same inline `transform: translate(-50%,-50%) scale(...)` that resolves to a normal CSS matrix in isolation computed to `transform: none` only when nested under that non-laid-out ancestor — the documented behavior for a percentage-based transform with no box to resolve against, and independent corroborating evidence for the same root cause. **Fix**: moved `[data-print-doc]` to be a sibling of `[data-app]`, both under one top-level fragment, instead of a child.

### Also worth noting (lower-stakes, quicker to diagnose)

- **Missing baseline Postgres grants.** RLS policies were correct from the start, but `permission denied for table cards` blocked every request anyway — the `anon` role also needs table-level `GRANT`s underneath RLS, which this Supabase project didn't have by default. Fixed with explicit `grant` statements (`0001_init.sql:196-197`).
- **A blocking `alert()` on failed card creation.** Not a logic bug, but worth recording: an early version of `CreateScreen.jsx`'s error handler used `alert()`, a synchronous native dialog that also happens to block browser automation tooling. Replaced with an inline error message component.

## Deliberate trade-offs

- **Payment and real email sending are placeholders, on purpose.** The "Upgrade" flow's payment form takes no real card details and calls no payment processor — but it *does* persist a real `unlimited: true` to the `cards` row on "payment," so the signature-cap trigger genuinely lifts for that card. Email sending is a toast notification and nothing else. Both were explicit product decisions to defer, not oversights — see `CHANGELOG.md` and `DECISIONS.md` for the specific exchanges where this was decided.
- **`CardScreen.jsx` is one 1,665-line component.** The original prototype was a single monolithic screen with tightly coupled gesture state (drag/resize/rotate/zoom/pan all sharing one `gestureRef`), tool state, and modal state. Splitting it into smaller components was considered and rejected for this rebuild: the interaction model genuinely is one interconnected state machine, and breaking it into pieces would have meant prop-drilling a large fraction of that state through component boundaries for no behavioral benefit. `ObjectView.jsx` is the one piece that *was* extracted, because it's purely presentational — it receives a fully-prepared descriptor and has no state or logic of its own.
- **Optimistic client-generated IDs, not server-generated.** New objects (draw strokes, stickers, photos, finished text notes) get `crypto.randomUUID()` on the client and are added to local state before the network request resolves, with that same ID sent to the insert. This keeps interaction latency at zero — no waiting on a round trip to see your own sticker land — and makes the inevitable Realtime echo of your own insert a harmless no-op merge-by-id instead of a duplicate.
- **Drag/resize/rotate persist only on release, not per-frame.** Pointer-move updates during a gesture touch local React state only; the database write (and the Realtime broadcast to other viewers) happens once, on `pointerup` (`CardScreen.jsx:275-352`). Avoids flooding Postgres/Realtime with a write per animation frame, at the cost of other viewers not seeing a drag *in progress* — only its result.
- **Photos: optimistic local preview, real upload in the background.** On file selection, the `card_objects` row is inserted immediately with `photo_path: null`; a local `URL.createObjectURL` blob is shown while the real upload to the `card-photos` Storage bucket happens, then the row is updated with the real path. Matches the original prototype's instant "polaroid fills in" feel while doing genuine network I/O instead of the prototype's fake in-memory base64.
- **Permissive RLS instead of a real permission system.** Covered in [Trust model](#trust-and-security-model) — noted again here because it's the trade-off with the widest blast radius: anyone with a card's link has full read/write access to that card via the Supabase API, not just through the app. Accepted deliberately because it matches the no-accounts product design exactly, not a shortcut taken under time pressure.
