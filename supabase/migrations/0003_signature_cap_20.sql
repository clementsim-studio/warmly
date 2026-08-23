-- Raise the free-plan signature cap enforced by enforce_signature_cap()
-- from 10 to 20, reframed as a performance guardrail rather than a paywall
-- (DECISIONS D-026). Re-creates the same function with only the constant
-- changed; the trigger itself is untouched.
-- Run this once in the Supabase SQL Editor for this project.

create or replace function enforce_signature_cap()
returns trigger language plpgsql as $$
declare
  is_unlimited boolean;
  already_counted boolean;
  signed_count int;
  limit_count constant int := 20;
begin
  if new.type <> 'text' or new.owner_id is null then
    return new;
  end if;

  select unlimited into is_unlimited from cards where id = new.card_id;
  if is_unlimited then
    return new;
  end if;

  select exists (
    select 1 from card_objects
    where card_id = new.card_id and type = 'text' and owner_id = new.owner_id
  ) into already_counted;

  if already_counted then
    return new;
  end if;

  select count(distinct co.owner_id) into signed_count
  from card_objects co
  join signers s on s.id = co.owner_id
  where co.card_id = new.card_id and co.type = 'text' and s.name is not null;

  if signed_count >= limit_count then
    raise exception 'signature_cap_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;
