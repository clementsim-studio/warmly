# Warmly — project context

## What this is
A shareable digital group card. Someone creates a card, gets a link, and anyone with the link can add a note, photo, sticker, or drawing to it — no accounts required.

## Stack
- Frontend: React (Vite) — originally built as a prototype in Claude Design, converted to a real React app
- Backend: Supabase (Postgres + Realtime + Storage)
- Hosting: Vercel

## Key architectural decisions (see DECISIONS.md for full detail)
- **No user accounts.** Identity is a random ID generated in-browser on first visit and stored in localStorage per card. This is intentional — matches the original prototype's trust model.
- **Shareable links use random UUIDs**, not pretty slugs — chosen for guaranteed uniqueness (a name-based slug like `olivia-birthday` can collide across different cards; a UUID can't).
- **card_objects is one flat table** for all canvas item types (text/photo/sticker/draw), not split per type — mirrors the frontend's original single-array data model, minimizes translation work.
- **Signature cap (10 free signers) is enforced server-side via a Postgres trigger**, not just in frontend JS — this cannot be bypassed by a technical user hitting the API directly.
- **Payment and real email sending are deliberately deferred/placeholder** for now — only build these out when explicitly asked.

## Still fake / placeholder (don't assume these are real)
- Email sending — currently a toast notification, no real service wired up
- Payment/upgrade flow — UI exists, no real Stripe integration

## Workflow for this project
- New UI/visual changes → design in Claude Design first, export, hand to Claude Code with a scoped instruction (what to keep untouched).
- New logic-only changes → describe directly, no need for Claude Design.
- Any change touching the schema or trust model → discuss and get explicit sign-off before implementing.
