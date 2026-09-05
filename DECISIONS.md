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

## Archived features stay in code behind a `false` flag, not deleted

**Decision**: `src/lib/featureFlags.js` exports `FEATURE_MONETIZATION` and `FEATURE_PREVIEW_AND_SEND_PAGE`, both `false`. The old "Preview & send" full-page flow (mockup preview, fake email-the-card path) and the "Warmly Unlimited" upgrade dialog are still fully implemented and rendered, just gated behind `FEATURE_X && ...` at every entry point and render site, so they have no reachable path in the current build.

**Why**: A 2026 design refresh (see `design_handoff_warmly/`) retired both features from the product surface but explicitly wants them recoverable later (a paid tier, and a richer print-shop mockup flow) rather than rebuilt from scratch. Flipping one constant back to `true` restores a feature exactly as it was, with no code archaeology. The alternative — deleting the code and relying on git history — makes "bring it back" a multi-file reconstruction instead of a one-line change.

## Note commits (typed text + inline signing) route through one function, guarded by a ref

**Decision**: `commitBox(id)` in `CardScreen.jsx` is the single path that finalizes a text box — both the communal cover-template text (no signing) and a regular note (which may also adopt the typist's name on first save). It's invoked from the box's own `onBlur` *and* from the canvas's click-away handler (`onSurfaceDown`), and is re-entrancy-guarded with a plain `useRef`, not React state.

**Why**: A click away from an editing box can trigger both paths for the same object in one interaction — native `blur` (via the browser's default mousedown-driven focus change) and the canvas's `onPointerDown`-based click-away, which fires first. Two independent commit paths previously existed for this (one for cover text, one for notes); consolidating to one function means a signature cap rejection, a name-adoption, or a Supabase insert can only happen once per commit, not once per triggering event. A `useRef` guard (not `useState`) is required because it must block the second call synchronously, before React has necessarily flushed the first call's state updates.

## Card lifespan (14 days) is computed client-side from `created_at`; no new column

**Decision**: `archives_at = cards.created_at + 14 days`, computed in the browser wherever it's displayed (Share dialog info strip, near-expiry nudge). Nothing is written to the database for this.

**Why**: The date is pure derived data — it never needs to be queried, filtered, or indexed on its own, so a stored column would just be a value that can drift out of sync with its source. The actual archival job (a scheduled task that acts on cards past this date) is separate, not-yet-built backend work; the client-side display doesn't depend on it existing.

## PDF export rasterizes each face with html2canvas, then assembles a real PDF with jsPDF — `window.print()` is the fallback, not the primary path

**Decision**: `downloadPdf()` renders the cover and inside faces into an off-screen, off-DOM node each, captures them via `html2canvas` at a resolution scaled to the chosen page size (capped 1×–4×), and adds both as full-page JPEGs to a `jsPDF` document sized to match. Any failure in that path falls back to the pre-existing `window.print()` flow (with the same dynamically-injected `@page` size), so a download attempt never dead-ends.

**Why**: `window.print()` hands control to the browser's native print dialog — the user has to choose "Save as PDF" themselves and the result depends on browser/OS print settings, which isn't a real one-click download. html2canvas + jsPDF produce an actual `.pdf` file with `pdf.save(...)`, matching the product's "Download as PDF" promise literally. The fallback exists because rasterizing arbitrary DOM (photos, cross-origin images) can fail in ways worth not surfacing as a dead end to the user.

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

## Print-only markup (`[data-print-doc]`) must be a sibling of `[data-app]`, never a descendant

**Decision**: The PDF-export markup (rendered via `dangerouslySetInnerHTML` into two `.print-page` divs) is a sibling of the main `[data-app]` wrapper, both under a single top-level `<>` fragment in `CardScreen`'s return — not nested inside `[data-app]`.

**Why**: Another real, deployed bug, not a stylistic choice. The print stylesheet hides the live app and shows the print doc: `[data-app]{display:none} [data-print-doc]{display:block!important}`. `data-print-doc` was originally a *child* of `data-app`. A `display:none` ancestor removes its entire subtree from rendering — a descendant's own `display` value, `!important` or not, cannot override an ancestor's `display:none`; that's not a specificity fight, it's how the box tree works. So the print content was unconditionally blank. Confirmed by walking the DOM ancestor chain (`[data-app]` showed up as a `display:none` ancestor of the print content) and by observing that the same inline `transform` that resolves to a normal matrix in isolation computes to `transform: none` once nested under a non-laid-out ancestor — the expected behavior for a percentage-based transform with no box to resolve against. Any future print-only, download-only, or export-only markup in this codebase needs to live outside `[data-app]` for the same reason.

## 14-day card lifespan enforced live, no cron job and no stored flag

**Decision**: `enforce_card_not_resting()` (migration `0004_card_lifespan.sql`) fires `before insert/update/delete` on `card_objects` and `before update` on `signers`, computing `now() > cards.created_at + 14 days` fresh on every write — there's no `archived` column and no scheduled job. Client-side, `CardScreen` shows a plain placeholder screen ("This card has settled") instead of the canvas once that same computation is true, checked at load time right alongside the existing `loading`/`notFound` early returns.

**Why**: `archives_at` is a pure function of `created_at` that never changes, so there's nothing for a cron job to compute that a live check at write time doesn't already give you, exactly, with no lag. A cron-based `archived` flag would need pg_cron enabled and would drift by up to one job interval — a card could still accept writes for hours past its real cutoff. The trigger reuses `enforce_signature_cap()`'s established role: the one guardrail that can't be bypassed by calling the API directly. `signers` only guards `update` (signing), not `insert`, because `ensureSigner()`'s identity-provisioning upsert has to keep working on a resting card so the page can load far enough to show the placeholder at all.

**Note**: the placeholder screen is explicitly temporary — the user intends a real "expired" page design later. Until then this is deliberately the plainest possible screen, matching the existing `notFound` state's style, not a preview of the final design.

## Daily new-card limit (~100/day) enforced by a trigger, UTC calendar day

**Decision**: `enforce_daily_card_limit()` (migration `0005_daily_card_limit.sql`) fires `before insert` on `cards`, counting rows created since `date_trunc('day', now())` and rejecting the 101st. "Today" is a UTC calendar day — no timezone configured anywhere. `CreateScreen` catches this specific rejection and shows "Warmly's at capacity for today — try again tomorrow" instead of the generic creation-failed message; there's no proactive pre-check before submit.

**Why**: Same shape as `enforce_signature_cap()` — the one thing a client-side-only check can't guarantee is that it can't be bypassed by calling the API directly, so the real limit has to live in a trigger. UTC avoids any timezone handling in the stack; the reset time not matching any particular user's midnight is an accepted tradeoff for that simplicity. No pre-check on page load because the signature cap doesn't do that either (it only reacts at submit time) and 100 cards/day makes hitting this a rare edge case — matching existing precedent beat adding a new UX pattern for it.

## Feedback is the one table not written directly from the browser

**Decision**: `feedback` (migration `0006_feedback.sql`) has RLS enabled with **zero policies** for anon/authenticated — the browser has no access to it at all, not even to read. The only write path is `api/feedback.js`, a Vercel serverless function using the Supabase **service-role key**, which bypasses RLS entirely. `CardScreen`'s `submitFeedback()` now `POST`s to that endpoint instead of just flipping local React state.

**Why**: Every other table in this app is written directly from the browser with the anon key — that's the whole "no server code of our own" model. Feedback breaks that pattern because it needs two things that only exist on a real server-side request: the actual client IP (to hash) and Vercel's geo headers (`x-vercel-ip-country`) — a browser can't produce either honestly, since a malicious client could just send whatever IP/country it wants in a payload. Once a server-side function exists at all, giving the browser direct write access to the table would be pointless — the function can and should be the only door.

**Also decided**: no `unique(card_id, signer_id)` constraint. Repeat submissions from the same signer on the same card are allowed and just insert another row — `signer_id` and `ip_hash` are recorded on every row specifically so repeat submissions can be found later with a query, without the submission path itself blocking or deduplicating them at write time.

**IP hashing**: SHA-256 of the IP **plus a server-only secret salt** (`IP_HASH_SALT`, a Vercel env var never exposed to the client). An unsalted hash of an IPv4 address is reversible by simply hashing all ~4 billion possible addresses once and building a lookup table — the salt is what actually makes `ip_hash` a one-way value instead of security theater.

**Follow-up fix**: shipping this initially failed in production with `permission denied for table signers` (42501) — `service_role` bypasses RLS by default but was never granted base table privileges (migration `0001_init.sql` only granted `anon`/`authenticated`). Fixed in `supabase/migrations/0007_service_role_grants.sql`. See the next entry — this is the second time this exact category of bug has hit this project.

## RLS and table GRANTs are two independent layers — always check both for a new role or table

**Decision**: Whenever this project adds a new Postgres role to any table (a new client role, or a server-side role like `service_role`), grant its base table privileges (`select`/`insert`/`update`/`delete`, and `usage` on the schema) explicitly in the same migration that adds the role's first access to that table — never assume RLS configuration alone is sufficient, and never assume Supabase auto-grants a role's privileges by default.

**Why**: This project has now hit the identical bug twice, in two different directions:
- **`anon`/`authenticated`** (migration `0001_init.sql`): RLS policies were correct from the start, but the baseline roles had never been granted `select`/`insert`/`update`/`delete` on `cards`/`signers`/`card_objects` — every read and write failed with `permission denied for table cards` until the migration added explicit `grant` statements.
- **`service_role`** (migration `0007_service_role_grants.sql`): the opposite direction — a role that bypasses RLS entirely by default was still missing the underlying table grant, so `api/feedback.js` failed with `permission denied for table signers` (42501) the first time a server-side role touched the database at all.

In Postgres, RLS policies only ever restrict what an already-permitted role can see or touch — a role with **zero base grant** on a table is denied outright, before RLS is ever evaluated, regardless of whether RLS would have bypassed or permitted the operation. Two structurally different mechanisms, both required, and this codebase has now been bitten by assuming one implies the other in both directions. **Any future migration that introduces a new role, or gives an existing role its first access to a new table, should explicitly grant that role's privileges and not rely on inference from RLS state or Supabase defaults.**

## Mobile breakpoint and bar heights have exactly one source of truth each

**Decision**: The `@media (max-width:640px)` block in `styles.css` is the *only* place 640 is written — it sets a `--m-mobile` CSS custom property, and `isMobileView()` reads that property rather than hard-coding its own pixel value. Similarly, the edge-anchored top/bottom bars' real heights are measured once (via `ResizeObserver`, since the bottom bar's height genuinely varies with which context row is open) into `--m-topbar`/`--m-bottombar`, and both the canvas's positioning *and* `fitZoomFor`'s fit calculation read those same two properties rather than each hard-coding a guessed offset.

**Why**: The design handoff's own history (D-037) recorded a real bug from exactly this class of mistake in the reference prototype — a breakpoint value duplicated across a CSS query and a JS constant drifted out of sync, so a band of viewport widths got the mobile CSS layout with the desktop JS behavior, silently reopening a clipping bug that had already been fixed once. Deriving every consumer from one declaration instead of repeating the literal makes that class of drift structurally impossible here, not just corrected for now.

## Zoom-to-write has its own centring function — never reuses setZoomAt, never animates

**Decision** (supersedes an earlier, wrong version of this entry): `zoomToWriteIfNeeded(canvasX, canvasY)` takes the *canvas-space* point to centre — the new note's placement for a fresh note, `(o.x+120, o.y+18)` (the note's own centre, reversing `createText`'s placement offset) when re-editing — and calls a dedicated `scrollCardPointIntoCenter()`, never `setZoomAt`. The zoom change itself is never animated: `zoomAnimating` is forced `false` before `setZoom`, the centring runs in the next `requestAnimationFrame` against the now-final geometry, and only then is `zoomAnimating` set back to `true`.

**Why**: An earlier version of this reused `setZoomAt` (which anchors whatever screen point was under the gesture through a zoom — correct for pinch/wheel, not for this) and added a CSS transition to address a separately-reported "awkward" feel. Those two choices interacted badly: the transition meant the surface was still mid-animation on the very next frame, so any post-zoom re-measurement read an in-flight scale, not the final one — landing the scroll on the card's actual top-left instead of the new note, which is what a user directly reported and confirmed persisted even after a first (wrong) fix attempt. Diffing directly against `design_handoff_warmly/Warmly.dc.html` (which does not have this bug) surfaced the real design: `scrollCardPointIntoCenter` measures the *delta between the surface's rect and the scroller's rect directly* (so it's correct regardless of the scroller's padding or the surface box's `margin:auto` centring, without needing to reason about that geometry from first principles), and D-043's "suppress the transition for this one update" isn't a nice-to-have — it's load-bearing, because the whole approach depends on measuring settled, non-animating geometry.

**Lesson**: when a symptom looks like "wrong position," check for an active CSS transition before trusting any `getBoundingClientRect()` read taken on the very next frame after a state change — the read can be completely correct in its own logic and still describe a transient, not the destination.

## Signing/renaming is one path — a regression, not a new decision

**Decision**: There is exactly one way to set or change your signature: the always-present sign field inside a note's edit box (pre-filled with your current name once you have one). A previous session had reintroduced a second path — tapping a signature in read state opened a standalone rename input independent of `editingId` — which D-036 (an earlier handoff) had already explicitly removed as a third state. It's removed again; `commitBox`'s adopt logic now triggers on "the typed name differs from `meName`" (covers first-time signing and renaming alike) rather than "wasn't signed yet", so renaming doesn't need a separate code path at all.

**Why record this as a decision rather than just a bug fix**: this is the second time this exact interaction has been built and removed. The risk is structural, not a one-off mistake — any future feature touching signature display should route through the edit box's own field, never add its own click handler on the read-state signature text, or this will regress a third time.

## Full-height screens centre with `margin:auto`, never `align-items:center` (D-047)

**Decision**: `CreateScreen` and `ShareScreen`'s scroll containers use `align-items:flex-start`, with `margin:auto` on the panel child doing the actual centring. Mobile additionally reduces the hero title/subhead font sizes and container padding (`[data-startwrap]`/`[data-starttitle]`/`[data-startsub]`, `@media(max-width:640px)`).

**Why**: `align-items:center` on an `overflow:auto` container distributes any overflow **equally above and below** the centred content. The half that lands above the top edge is unreachable — a scroll container has no negative `scrollTop` to scroll to it with. On a short mobile viewport, this cut off the brand mark and headline with no way to reach them; desktop never showed it because the content fit. `margin:auto` produces identical centring when there's spare room, but auto margins resolve to **zero**, never negative, when there isn't — so any overflow only ever extends downward, into scrollable territory. (`align-items:safe center` is the other real fix, but has weaker browser support, so wasn't used.)

**Lesson, matching the handoff's own framing**: "content is clipped and unscrollable" on a centred scrolling container is almost always the alignment property, not the overflow/scroll setup — check that first. And this class of bug is invisible whenever the content happens to fit the viewport, so it only ever shows up on a short screen — test centred full-height layouts at a short viewport specifically, not just a narrow one.

## Zoom-to-write re-centres a second time once the keyboard actually settles

**Decision**: `zoomToWriteIfNeeded` remembers the canvas-space point it centred (`writeZoomTargetRef`); a `window.visualViewport` `resize` listener (registered once, for the component's lifetime) re-runs `scrollCardPointIntoCenter` against that same point, debounced 120ms, whenever the visual viewport's size changes while that ref is set.

**Why**: The scroll-container-vs-surface-rect fix (previous entry) got the *coordinate math* right, but a real device exposed a second, independent problem: our own zoom-to-write centring runs immediately, well before the on-screen keyboard — and whatever accessory bar iOS decides to show above it (predictive text, autofill) — finishes animating in. Neither the scroll container's own `getBoundingClientRect()` nor any DOM measurement we already take reflects the keyboard's presence; `visualViewport` is the one API that reliably fires once it has actually settled. Debounced rather than reacting to every intermediate resize tick, since the keyboard's own slide-in fires several before landing, and re-centring against each of those would fight the animation instead of waiting it out.

**Scope note**: this shipped as a deliberate, incremental second pass — the user explicitly asked to try "react to the keyboard settling" as a narrower fix before considering removing zoom-to-write on mobile entirely, rather than accepting the first (coordinate-only) fix as good enough once a different, real symptom remained.

## Zoom-to-write removed on mobile — pinch-zoom only, by explicit choice

**Decision** (supersedes the two entries above, which describe now-deleted code): mobile no longer auto-zooms when starting or re-editing a note. Zooming on a phone is pinch-only again, exactly as it was before zoom-to-write existed.

**Why**: the coordinate math was eventually made fully correct (confirmed by the user directly on-device), and the keyboard-settle follow-up (`visualViewport` re-centring) was a reasonable, narrower next attempt — but it *also* didn't resolve the problem on the user's actual device. Rather than continue iterating against device- and setting-specific keyboard/accessory-bar behavior with no way for either of us to verify a fix without another full round-trip of real-device testing, the user chose to accept the simpler trade-off: on a very zoomed-out card, the text you're typing stays small until you pinch-zoom in yourself. This is a real, acknowledged loss of a touch (D-035's whole rationale was legibility while typing), but it trades an intermittently-broken affordance for a plain, reliable one.

**If revisited**: the coordinate math (`scrollCardPointIntoCenter`'s rect-delta approach, in the git history of this file's earlier entries) was verified correct and is the right foundation to build on — the open problem was purely about *when* to run it relative to the keyboard's own animation, not the positioning formula itself.

## Selection frame stays visible while editing, with a dedicated move grip (D-054)

**Decision**: `showFrame` (the selection outline plus rotate/resize/remove handles) is no longer hidden while a note is being edited — it was previously `grabbable && selected && !isThisEditing`, now it's just `grabbable && selected`. A fourth handle, the move grip, appears only while editing (`showMoveGrip = grabbable && selected && isThisEditing`) and calls `startMove(o, e, true)` — the `force` flag bypasses `startMove`'s existing `if (editingId === o.id) return` guard, which otherwise exists specifically to stop dragging-the-object-body from fighting the textarea's own text selection while it has focus.

**Why**: the handoff's written change list said "all four controls (move, rotate, resize, remove) must stay visible... do not hide any of them in favour of gestures" without naming the move grip explicitly. Diffing directly against `design_handoff_warmly/Warmly.dc.html` (`d.showMoveGrip`/`d.onGripMove`, gated on `editingId===o.id`) confirmed this is a real, distinct control — not the same thing as dragging the object body, which the editing textarea's focus makes unsafe to reuse directly. Handles are counter-scaled (`1/(objectScale × canvasZoom)`, constant 32px desktop / 42px mobile) so the same fix that makes them a stable on-screen size while zoomed also had to account for this fourth control.

## Pinch pointerdown reads a plain ref, not the gesture effect's own state

**Decision**: the capture-phase `pointerdown` listener that starts a pinch (D-053) needs to read current `objects`/`selectedId`/`panning`/`fullControl` to decide whether the gesture resizes a selected object or zooms the canvas. Rather than adding those to the surrounding `useEffect`'s dependency array, a separate, no-dependency-array `useEffect` mirrors them into `pinchLiveRef` on every render, and the pointerdown handler reads `pinchLiveRef.current`.

**Why**: `objects` changes on every keystroke and every drag frame; `selectedId`/`panning` change almost as often. Including them in the gesture effect's deps would tear down and re-attach all six of its `window` listeners on nearly every render — wasteful, and risks dropping a gesture that's mid-flight exactly when a listener is momentarily detached. The existing `onDocUp` already avoids this same trap for `objects` specifically, via `setObjects(prev => ...)`'s functional form; the live-ref mirror generalizes that same idea to values that only need reading, not updating.

## Pinch's "suppress the zoom transition" step doesn't exist here — by design, not an oversight

**Decision**: the reference's pinch handling (D-053) suppresses a general 250ms eased zoom transition for the duration of a live pinch gesture, restoring it on release. This codebase has no such transition to suppress — it never had one; the closest thing (zoom-to-write's own animation) was removed entirely per explicit user request (see the "Zoom-to-write removed on mobile" entry above), and that removal predates this pinch work.

**Why recording this**: a future reader diffing against the reference might notice the missing suppression/restore step and assume it was dropped by mistake. It wasn't — there's nothing to suppress. If a general eased zoom transition is ever added back (e.g. for the wheel/keyboard/button zoom paths), pinch's `onDocMove` handler is exactly where the same suppression would need to be reintroduced, mirroring the reference's `endZoomAnimSuppression` pattern.

## Expired cards are hard-deleted at 15 days by a scheduled Edge Function

**Decision**: A card is frozen (read-only) at 14 days by the existing `enforce_card_not_resting()` trigger, then **permanently deleted at 15 days** by `supabase/functions/purge-expired-cards`, invoked once a day by `pg_cron` → `pg_net` (migration `0009_schedule_purge_expired_cards.sql`). The function deletes the card's Storage folder (`card-photos/<cardId>/`) and then the `cards` row; `ON DELETE CASCADE` takes `signers` and `card_objects` with it. This is irreversible — no archive, no export; the link then 404s to the existing "This card doesn't exist." screen. Confirmed explicitly with the user, including that it's a hard, unrecoverable delete.

**Why an Edge Function and not pg_cron alone**: `TRUNCATE`/`DELETE`/`CASCADE` in Postgres never touch Supabase Storage, so a pure-SQL job would leave every expired card's photos orphaned in the bucket, still counting against storage. The function is the one place that holds both the DB client and the Storage client, so it can do both halves in the right order (Storage first, then the row) in a single invocation. `pg_cron` still drives the schedule; it just calls out to the function via `pg_net` rather than running the delete itself.

**Why 15 days, not 14**: the card is already frozen at 14 (`enforce_card_not_resting`), so the extra day of retention is invisible to users and costs one day of a tiny row plus its photos. It buys slack against clock skew, a cron run that's skipped or fails, and a support request that arrives right on the boundary — after deletion there is nothing to recover. The purge cutoff (`LIFESPAN_DAYS = 15` in the function) is a deliberately separate number from the freeze cutoff (`14 days`, hard-coded in the trigger and mirrored as `14 * DAY_MS` in `CardScreen.jsx`); the 14 is now written in three places and the 15 in one — see the note below.

**Why `feedback` is exempt from the cascade**: the user wants feedback retained for launch analytics after the card is gone. Migration `0008` changes `feedback.card_id` and `feedback.signer_id` from `NOT NULL` + `ON DELETE CASCADE` to nullable + `ON DELETE SET NULL`, so a purge nulls those references instead of deleting the row. Because that loses the ability to join back to `cards`, `api/feedback.js` now also writes `card_occasion` and `card_format` onto each feedback row at submission time — a frozen snapshot, plain `text` with no CHECK (it must not start rejecting rows if the occasion list widens again, as it did in migration 0002). The `ip_hash`/`country`/`rating`/`comment`/`created_at` payload was already independent of the card.

**The 14-day literal now lives in three places** — the `enforce_card_not_resting()` trigger (`interval '14 days'`), the client (`14 * DAY_MS` in `CardScreen.jsx`), and implicitly as the floor of the purge function's `LIFESPAN_DAYS = 15`. There is no shared constant across SQL + browser JS + Deno. If the lifespan ever changes, all three move together, and the purge value must stay strictly greater than the freeze value or cards would be deleted while still editable. This is an accepted, documented duplication, not an oversight — flagged here so a future change doesn't miss one.

**What this job does not do**: it does not enforce the freeze (the trigger does), it does not run on any user-facing request path, and it rejects any HTTP call that doesn't carry the service-role bearer token, so the public function URL can't be used to trigger an early purge.
