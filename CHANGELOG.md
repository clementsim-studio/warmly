# Changelog

Notable changes to Warmly, newest entry first. See [DECISIONS.md](./DECISIONS.md) for the reasoning behind architectural choices, not just what changed.

## 2026-08-27 (follow-up)

A fourth-handoff bug-fix pass after testing the mobile rebuild below — two bugs the user caught directly, plus D-047 and a documentation-only mismatch. Frontend only, no migrations.

### Fixed
- **The signature was still independently editable.** The old tap-signature-to-rename mode (explicitly removed by D-036 in an earlier handoff) had regressed back in: `tapSign()`/`submitSign()`/`signingId` drove a standalone rename input separate from the note's own edit state. Tapping a signature now opens the whole note's edit box exactly like tapping the message — there is no signature-only edit path any more. Renaming now happens through the edit box's own sign field, which is always present for your own notes (not just before you've first signed) and pre-filled with your current name.
- **Zoom-to-write snapped instantly with no easing**, which read as an "awkward" jump on mobile. Added a short eased transition (320ms) bracketing only the zoom-in/zoom-out moment (D-035's own stated mitigation) — manual pinch/wheel/button zoom is unaffected, still instant.
- **Start/Share screens were cut off at the top on mobile, with no way to scroll up to reach it.** Root cause: the scroll container used `align-items:center`, which distributes overflow equally above and below — the part above the top edge is unreachable (no negative `scrollTop`). Fixed with `align-items:flex-start` + `margin:auto` on the panel instead, which only ever overflows downward. Also shrinks the hero type and container padding at ≤640px so there's less to overflow (D-047).
- **Mobile top bar Share/Download didn't match the reference**: they were 36px labeled pills instead of 40×40 icon-only circles, which is what actually allows five controls to fit one 56px row.

### Notes
- Verifying the previous round's mobile rebuild is still pending browser testing on your end — these fixes are on top of, not instead of, that testing.

## 2026-08-27

Third design handoff (`design_handoff_warmly/`, D-030 → D-046) — a set of real, confirmed bugs the new "Hard-won constraints" section flagged, plus a full mobile layout rebuild. No backend/migration changes this round — frontend only.

### Fixed
- **Canvas scaling now uses `transform`, never CSS `zoom`.** `zoom`'s effect on `getBoundingClientRect()` is inconsistent across engines (iOS in particular), which collapsed new text/strokes toward the canvas's top-left at non-1.0 zoom. The surface now has a layout-sized wrapper (`data-surfacebox`) plus a `transform: scale()` element inside it (D-041).
- **Switching Cover/Content, re-templating the cover, or opening Background no longer strands an uncloseable white edit box.** Render decisions used to read a per-object `editing` flag while control flow read the separate `editingId` state; three places cleared `editingId` without committing first. `editingId` is now the sole source of truth (D-044).
- **Drawing on a touch device works.** The canvas never set `touch-action` while Draw was active, so a scroll-container ancestor could claim the gesture before any `pointermove` fired. Scoped `touch-action:none` to Draw, plus `pointercancel` now commits an in-progress stroke instead of hanging it (D-039/D-040).
- New text now appears at the centre of the visible canvas rather than the raw tap point — precise tap placement was never reliable across mobile engines (D-034).

### Added
- **Mobile (≤640px) card screen rebuilt**: solid edge-anchored top/bottom bars replace the floating-pill chrome, with real bar heights measured into CSS custom properties so the canvas never clips behind either. Signatures + Feedback moved into a "⋯" overflow menu; the Cover/Content toggle shows a label only on its active segment, plus a one-time coach mark on first visit. Zoom pill hidden (pinch instead). Breakpoint has one source of truth (`--m-mobile`, read by JS instead of a duplicated pixel literal) (D-031/D-032/D-037).
- **Zoom-to-write**: on a phone, if the canvas is currently too small to write legibly (effective scale < ~0.7), starting or re-opening a note zooms in to 0.85 and eases back to the previous zoom on commit. Desktop is unaffected at any window size (D-035).

### Removed
- The near-expiry nudge banner and its demo toggle — the 14-day lifespan is now stated only once, in the Share dialog (D-046).

### Changed
- Start screen: "Who is it for?" now comes before "The occasion".

### Notes
- Zoom-to-write re-centres on the current viewport, not precisely on an off-screen note being re-edited — a known simplification, not a bug.
- None of this has been checked in an actual browser (see CLAUDE.md workflow) — verify the mobile layout, drawing on a real touch device, and the editingId fix's three trigger paths before trusting them.

## 2026-08-26

### Added
- Feedback submissions are now actually stored, not just shown as a local thank-you screen: a new `feedback` table (`supabase/migrations/0006_feedback.sql`) records rating, comment, signer_id, a salted hash of the submitter's IP, and their country (from Vercel's geo headers). Written through a new serverless function, `api/feedback.js` — the project's first server code — since the table is unreachable from the browser (RLS enabled, no client policies at all). Repeat submissions from the same signer on the same card are allowed by design; nothing is deduplicated at write time.

### Fixed
- **`api/feedback.js` failed with `permission denied for table signers` (42501).** Root cause: migration `0001_init.sql` granted table privileges to `anon`/`authenticated` only — `service_role` (used by the new serverless function) was never granted `select`/`insert`/`update`/`delete` on any table. Bypassing RLS and holding the underlying table grant are two independent things in Postgres; `service_role` does the former by default but this project's Supabase instance doesn't do the latter automatically. Same category of gotcha as the original anon-role GRANT issue below. Fixed in `supabase/migrations/0007_service_role_grants.sql`, which also adds an `alter default privileges` rule so this can't recur for any table created from now on.

### Notes
- **Migrations not yet run**: `0006_feedback.sql` and `0007_service_role_grants.sql` need to be applied in the Supabase SQL Editor.
- **New Vercel env vars needed**: `SUPABASE_SERVICE_ROLE_KEY` and `IP_HASH_SALT` (server-side only — see `.env.example`), or `api/feedback.js` will fail with `server_misconfigured`.

## 2026-08-24

### Added
- 14-day card lifespan is now enforced, not just displayed: a new trigger (`supabase/migrations/0004_card_lifespan.sql`) rejects writes to `card_objects` and signer-name updates once a card is past 14 days old, and `CardScreen` shows a plain placeholder screen ("This card has settled") instead of the canvas for resting cards. The placeholder is explicitly temporary — a real "expired" page design is still pending.
- System-level rate guard: at most 100 new cards per UTC day, enforced by a new trigger (`supabase/migrations/0005_daily_card_limit.sql`). `CreateScreen` shows a graceful "Warmly's at capacity for today — try again tomorrow" message on rejection instead of the generic creation-failed error.

### Notes
- All four migrations above (`0002`–`0005`) have been applied.

## 2026-08-23

Brought the app in line with a 2026 design refresh (`design_handoff_warmly/`) via a 12-commit sequence, each built, reviewed, and pushed separately.

### Added
- Occasion model expanded from 2 to 5 (Birthday, Farewell, Thank you, Graduation, Others), each with a literal emoji, a deliberate one-off exception to the app's otherwise SVG-only iconography (`src/lib/occasions.js`).
- Signature cap raised from 10 to 20, reframed as a performance guardrail rather than a paywall; monetization language removed from the cap-reached copy.
- Inline signing: typing your name while finishing a note now signs it in the same motion, instead of a separate popup after the fact.
- 14-day card lifespan shown to users: a calm info strip in the Share dialog, and a dismissible near-expiry nudge banner with a demo toggle (in the signers popover) for previewing it without waiting two weeks.
- A quiet "Feedback" button (bottom-right) opening a 1–5 star + optional-text dialog; auto-opens ~1.2s after a successful download, once per session.
- Responsive behaviour under 620px: the Feedback button collapses to an icon and moves top-right; the tool pill scrolls horizontally instead of wrapping.
- A Download dialog (A4/A5/A6 size picker) replaces the old header "Preview" button as the primary download entry point.
- Real client-side PDF export: `html2canvas` rasterizes each face, `jsPDF` assembles a real two-page `.pdf` sized to the chosen page size — replacing `window.print()` as the primary download mechanism (new dependencies, added with explicit sign-off).

### Changed
- The old "Preview & send" full-page flow (mockup preview, fake email-the-card path) and the "Warmly Unlimited" upgrade dialog are archived behind feature flags (`src/lib/featureFlags.js`) — code stays, no reachable entry point. `window.print()` is now only a fallback if real PDF generation throws.

### Fixed
- A local variable inside the per-object descriptor builder shadowed the `signName` *state* variable, so the "Your name" rename input silently stopped reflecting what was actually typed. Renamed the local to remove the collision.

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
- **PDF download produced a blank page.** Root cause: `[data-print-doc]` (the print-only markup, holding the actual rendered cover/inside HTML) was nested *inside* `[data-app]`, and the print stylesheet sets `[data-app] { display: none }`. A `display:none` ancestor can't be overridden by a descendant's own `display` value — no CSS specificity trick fixes that — so the print content was always removed from rendering regardless of the `[data-print-doc] { display: block !important }` rule targeting it directly. Confirmed live: forced the print styles onto the page without opening the native print dialog, saw a genuinely blank page; walked the DOM ancestor chain and found `[data-app]` (not `[data-print-doc]`) as the display:none node; verified via an isolated `getComputedStyle` test that the same inline `transform` resolves to a matrix normally but computes to `none` only when nested under a non-laid-out ancestor, which is exactly the CSS spec behavior for percentage-based transforms with no resolvable box. Fixed by moving `[data-print-doc]` to be a sibling of `[data-app]` (both under a top-level `<>` fragment) instead of a child. Verified both print pages (cover + inside) render real content after the fix.

### Notes
- Email sending remains a fake toast placeholder (matches the payment placeholder) — explicit product decision, not yet implemented for real.
