-- Feedback must outlive the card it's about.
--
-- The 15-day purge (supabase/functions/purge-expired-cards, scheduled by
-- migration 0009) hard-deletes every expired card and, through the existing
-- ON DELETE CASCADE foreign keys, its signers and card_objects with it.
-- Feedback is kept for analytics, so it must NOT ride that cascade.
--
-- Two changes:
--
--   1. feedback.card_id and feedback.signer_id: NOT NULL dropped, and the
--      foreign-key action changed from CASCADE to SET NULL. After a purge
--      these columns are null; the analytics payload (rating, comment,
--      country, ip_hash, created_at) is untouched.
--
--   2. Two denormalised columns, card_occasion and card_format, written by
--      api/feedback.js on every new row. Once card_id goes null at purge
--      time, these are the only way left to segment feedback by the kind of
--      card it came from.
--
-- The FK constraint names below (feedback_card_id_fkey / feedback_signer_id_fkey)
-- are Postgres's automatic names for the inline `references` clauses in
-- migration 0006 — verify with `\d feedback` (or the Table editor) if this
-- project's schema was ever hand-edited.
--
-- Run this once in the Supabase SQL Editor for this project.

-- --- 1. let a feedback row survive its card and its signer -----------------

alter table feedback alter column card_id   drop not null;
alter table feedback alter column signer_id drop not null;

alter table feedback drop constraint if exists feedback_card_id_fkey;
alter table feedback add  constraint feedback_card_id_fkey
  foreign key (card_id) references cards(id) on delete set null;

alter table feedback drop constraint if exists feedback_signer_id_fkey;
alter table feedback add  constraint feedback_signer_id_fkey
  foreign key (signer_id) references signers(id) on delete set null;

-- --- 2. denormalised card context, frozen at submission time --------------
-- Deliberately plain `text` with no CHECK constraint: this is a snapshot for
-- analytics, not a live mirror of cards.occasion, and it must not start
-- rejecting rows if the occasion list widens again the way it did in
-- migration 0002.

alter table feedback add column if not exists card_occasion text;
alter table feedback add column if not exists card_format   text;

-- Backfill existing feedback while the cards it references are still here.
update feedback f
set    card_occasion = c.occasion,
       card_format    = c.format
from   cards c
where  c.id = f.card_id
  and  f.card_occasion is null;
