-- Feedback (star rating + optional comment), submitted from the Feedback
-- dialog in CardScreen.jsx.
--
-- Unlike every other table in this app, this one is NOT written directly
-- from the browser. It needs the real request IP (to hash) and Vercel's
-- geo headers, neither of which exist client-side or can be trusted if the
-- client claimed them — so writes only happen through api/feedback.js,
-- using the Supabase service-role key, which bypasses RLS entirely. RLS is
-- enabled here with zero policies: the anon/authenticated roles have no
-- access to this table at all, by design.
--
-- Deliberately no unique constraint on (card_id, signer_id) — repeat
-- submissions from the same signer on the same card are allowed and simply
-- insert another row. signer_id and ip_hash are recorded on every row so
-- repeat submissions can be queried for later if needed, without the
-- submission path itself blocking or deduplicating them.
--
-- Run this once in the Supabase SQL Editor for this project.

create table if not exists feedback (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references cards(id) on delete cascade,
  signer_id   uuid not null references signers(id) on delete cascade,
  rating      smallint not null check (rating between 1 and 5),
  comment     text,
  country     text,
  ip_hash     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_card_id_idx on feedback(card_id);
create index if not exists feedback_signer_id_idx on feedback(signer_id);
create index if not exists feedback_ip_hash_idx on feedback(ip_hash);

alter table feedback enable row level security;
-- No policies: anon/authenticated have zero access. Only the service-role
-- key (used server-side in api/feedback.js) can read or write this table.
