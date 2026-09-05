-- ===========================================================================
-- Warmly - pre-launch user-data wipe
-- ===========================================================================
-- Deletes ALL user-generated rows (cards, signers, card_objects, feedback -
-- feedback included on purpose: pre-launch test ratings would otherwise
-- pollute the launch analytics baseline).
--
-- Preserves everything structural: schema, triggers, RLS policies, grants,
-- indexes, the supabase_realtime publication, the card-photos Storage bucket
-- definition, AND the pg_cron "purge-expired-cards" schedule from migration
-- 0009 (it lives in the `cron` schema, which this script never touches - so
-- the 15-day purge job stays armed for real traffic after the reset).
--
-- Run in the Supabase SQL Editor (executes as the `postgres` role, so it
-- bypasses RLS and the fact that `cards` / `signers` have no DELETE policy).
--
-- This does NOT delete files in Supabase Storage. Run clear_storage.mjs
-- (or clear the bucket in the dashboard) separately - see that file.
--
-- Do NOT run this once the app is public and holding real cards.
-- ===========================================================================

-- Pre-flight: what is about to be removed (run on its own first if you want)
select
  (select count(*) from cards)        as cards,
  (select count(*) from signers)      as signers,
  (select count(*) from card_objects) as card_objects,
  (select count(*) from feedback)     as feedback;

begin;

-- Every user table named explicitly - no reliance on CASCADE to *reach* a
-- table. Order is irrelevant inside a single TRUNCATE.
--
--   RESTART IDENTITY - no-op today (all PKs are uuid default gen_random_uuid();
--                      there are no serial/identity columns or sequences).
--                      Left in so it stays correct if that ever changes.
--   CASCADE          - also a no-op today: the only foreign keys pointing into
--                      these four tables come from these same four tables, and
--                      all four are listed. TRUNCATE ignores each FK's ON
--                      DELETE action (SET NULL / CASCADE alike) - it truncates
--                      a referencing table because the FK exists at all - so
--                      migration 0008's switch to ON DELETE SET NULL on
--                      feedback changes nothing here. CASCADE would only ever
--                      matter if a future table adds an FK to one of these
--                      WITHOUT being added to this statement. Safe as written.
truncate table
  feedback,
  card_objects,
  signers,
  cards
restart identity cascade;

commit;

-- Post-flight: confirm all zero
select
  (select count(*) from cards)        as cards,
  (select count(*) from signers)      as signers,
  (select count(*) from card_objects) as card_objects,
  (select count(*) from feedback)     as feedback;
