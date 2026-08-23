-- Server-side enforcement of the 14-day card lifespan (DECISIONS.md).
--
-- No new column and no scheduled job: archives_at is always exactly
-- cards.created_at + 14 days and never changes, so "is this card resting?"
-- is a live computation at write time rather than a stored flag that a cron
-- job would need to keep in sync. The client already stops rendering the
-- canvas once a card is resting (CardScreen.jsx); this trigger is the
-- can't-be-bypassed-from-the-client backstop, same role
-- enforce_signature_cap() plays for the signature count.
--
-- Deliberately narrow: card_objects is fully guarded (insert/update/delete —
-- notes, photos, stickers, drawings, moves, removals all count as "changes").
-- signers only guards UPDATE (setting a name, i.e. signing) — not INSERT,
-- because ensureSigner()'s lazy identity-provisioning upsert must keep
-- working even on a resting card so the page can still load and show the
-- placeholder.
--
-- Run this once in the Supabase SQL Editor for this project.

create or replace function enforce_card_not_resting()
returns trigger language plpgsql as $$
declare
  cid uuid;
  card_created_at timestamptz;
begin
  cid := coalesce(new.card_id, old.card_id);
  select created_at into card_created_at from cards where id = cid;

  if card_created_at is not null and now() > card_created_at + interval '14 days' then
    raise exception 'card_resting' using errcode = 'P0001';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists card_objects_enforce_not_resting on card_objects;
create trigger card_objects_enforce_not_resting
  before insert or update or delete on card_objects
  for each row execute function enforce_card_not_resting();

drop trigger if exists signers_enforce_not_resting on signers;
create trigger signers_enforce_not_resting
  before update on signers
  for each row execute function enforce_card_not_resting();
