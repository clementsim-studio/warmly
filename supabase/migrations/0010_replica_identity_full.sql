-- Make DELETE events sync in realtime.
--
-- Symptom: adding or editing an object shows up on other viewers' screens
-- immediately, but deleting one does not — the other browser only catches
-- up on a full page refresh.
--
-- Root cause: the client subscribes to card_objects / signers changes with
-- a row filter (`card_id=eq.<cardId>`, see src/lib/cardData.js
-- subscribeToCard). Supabase Realtime evaluates that filter against the
-- change payload:
--   * INSERT / UPDATE payloads carry every column (payload.new), so the
--     filter matches and the event is delivered.
--   * DELETE payloads carry only the columns in the table's REPLICA
--     IDENTITY. The Postgres default is the primary key alone, so a DELETE
--     payload here is just { id }. It has no card_id, the filter can't
--     match it, and Realtime drops the event before sending it.
--
-- Fix: REPLICA IDENTITY FULL writes every column of the old row into the
-- replication stream on UPDATE and DELETE. The DELETE payload then
-- contains card_id, the filter matches, and the event goes out. The
-- client's DELETE handler is already correct
-- (setObjects(prev => prev.filter(o => o.id !== oldRow.id))) — it just
-- never received the event.
--
-- Cost: UPDATE/DELETE WAL entries on these two tables get bigger (the full
-- old row instead of just the id). card_objects rows are small (a short
-- note, or one SVG path string), so this is negligible at this app's
-- scale. No effect on reads, inserts, RLS, or any app logic.
--
-- card_objects is the table that actually matters (it's what the UI
-- deletes). signers is included for correctness — same latent bug — even
-- though nothing deletes signers today (no client DELETE policy; only the
-- purge job in migration 0009 removes them, via ON DELETE CASCADE).
--
-- Run this once in the Supabase SQL Editor for this project.

alter table card_objects replica identity full;
alter table signers replica identity full;

-- Verify: relreplident should read 'f' (full) for both rows.
--   d = default (primary key)   n = nothing   f = full   i = index
select relname, relreplident
from pg_class
where relname in ('card_objects', 'signers')
order by relname;
