-- System-level rate guard: at most 100 new cards per UTC day (README.md
-- "Backend requirements (not in the prototype)").
--
-- Mirrors enforce_signature_cap()'s role exactly — a before-insert trigger
-- that can't be bypassed by calling the API directly. The client shows a
-- graceful "at capacity today" message on rejection instead of a raw error
-- (see CreateScreen.jsx); this is the hard guardrail behind it.
--
-- "Today" is a UTC calendar day (date_trunc('day', now())) — simplest
-- option, no timezone configuration needed anywhere in the stack.
--
-- Run this once in the Supabase SQL Editor for this project.

create index if not exists cards_created_at_idx on cards(created_at);

create or replace function enforce_daily_card_limit()
returns trigger language plpgsql as $$
declare
  limit_count constant int := 100;
  today_count int;
begin
  select count(*) into today_count
  from cards
  where created_at >= date_trunc('day', now());

  if today_count >= limit_count then
    raise exception 'daily_card_limit_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists cards_enforce_daily_limit on cards;
create trigger cards_enforce_daily_limit
  before insert on cards
  for each row execute function enforce_daily_card_limit();
