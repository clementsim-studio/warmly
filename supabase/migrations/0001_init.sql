-- Warmly schema: cards, signers, card_objects, storage bucket, RLS, and the
-- server-side signature-cap trigger.
--
-- Run this once in the Supabase SQL Editor (or via `supabase db push`) for
-- project https://your-project-ref.supabase.co.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- cards
-- ---------------------------------------------------------------------------
create table if not exists cards (
  id            uuid primary key default gen_random_uuid(),
  recipient     text not null,
  occasion      text not null check (occasion in ('birthday', 'farewell')),
  format        text not null default 'landscape' check (format in ('landscape', 'portrait')),
  cover_color   text not null default 'blue' check (cover_color in ('blue', 'pink', 'green', 'yellow', 'purple')),
  cover_motif   text,
  cover_layout  text not null default 'centered' check (cover_layout in ('centered', 'bold', 'playful')),
  unlimited     boolean not null default false,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- signers — one row per participant on a card. Created (with name = null) the
-- first time a visitor's browser interacts with the card; `name` is filled in
-- once they actually sign.
-- ---------------------------------------------------------------------------
create table if not exists signers (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references cards(id) on delete cascade,
  name        text,
  color       text not null,
  created_at  timestamptz not null default now()
);

create index if not exists signers_card_id_idx on signers(card_id);

-- ---------------------------------------------------------------------------
-- card_objects — every note, photo, sticker, and drawing on the canvas.
-- owner_id is null for communal/cover-template pieces that aren't tied to a
-- single person.
-- ---------------------------------------------------------------------------
create table if not exists card_objects (
  id            uuid primary key default gen_random_uuid(),
  card_id       uuid not null references cards(id) on delete cascade,
  owner_id      uuid references signers(id) on delete set null,
  type          text not null check (type in ('text', 'photo', 'sticker', 'draw')),
  face          text not null default 'inside' check (face in ('front', 'inside')),
  communal      boolean not null default false,
  cover_kind    text,

  x             numeric not null default 0,
  y             numeric not null default 0,
  rotation      numeric not null default 0,
  scale         numeric not null default 1,

  -- text (regular notes, and cover-template title/name pieces)
  text          text,
  color         text,
  font          text,
  fsize         numeric,   -- cover-template text only: font size in px
  weight        numeric,   -- cover-template text only: font weight
  align         text,      -- cover-template text only: text-align

  -- sticker
  kind          text,

  -- photo
  photo_path    text,
  caption       text,
  tint          text,

  -- draw path, and cover-template text box width
  path_data     text,
  stroke_width  numeric,
  width         numeric,
  height        numeric,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists card_objects_card_id_idx on card_objects(card_id);
create index if not exists card_objects_card_id_type_idx on card_objects(card_id, type);

-- Cover-template pieces (cv-title, cv-name, cv-motif, ...) are re-seeded as a
-- set keyed by cover_kind. This constraint makes that seeding idempotent —
-- two concurrent first-loads of a brand-new card (or React StrictMode's
-- double-invoked effect in dev) can't both insert a full template set.
-- NULL cover_kind (every ordinary note/photo/sticker/drawing) is exempt from
-- uniqueness under standard SQL NULL semantics, so this only constrains the
-- template rows.
create unique index if not exists card_objects_card_cover_kind_uidx on card_objects(card_id, cover_kind);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists card_objects_set_updated_at on card_objects;
create trigger card_objects_set_updated_at
  before update on card_objects
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Server-side signature cap (free plan = 10 signers).
--
-- A person "counts" once they have a name AND currently have at least one
-- text object on the card. This trigger fires on every new text object: if
-- the owner isn't already among the counted signers, and the card is at the
-- free-plan cap, the insert is rejected — this can't be bypassed from the
-- client.
-- ---------------------------------------------------------------------------
create or replace function enforce_signature_cap()
returns trigger language plpgsql as $$
declare
  is_unlimited boolean;
  already_counted boolean;
  signed_count int;
  limit_count constant int := 10;
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

drop trigger if exists card_objects_enforce_signature_cap on card_objects;
create trigger card_objects_enforce_signature_cap
  before insert on card_objects
  for each row execute function enforce_signature_cap();

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table card_objects;
alter publication supabase_realtime add table signers;
alter publication supabase_realtime add table cards;

-- ---------------------------------------------------------------------------
-- RLS — the product has no accounts; anyone holding a card's link can read
-- and write it, matching the existing "no sign-ups, no accounts" design. The
-- signature-cap trigger above is the one hard guardrail that can't be
-- bypassed from the client.
-- ---------------------------------------------------------------------------
alter table cards enable row level security;
alter table signers enable row level security;
alter table card_objects enable row level security;

create policy "cards are publicly readable" on cards for select using (true);
create policy "anyone can create a card" on cards for insert with check (true);
create policy "anyone can update a card" on cards for update using (true);

create policy "signers are publicly readable" on signers for select using (true);
create policy "anyone can add a signer" on signers for insert with check (true);
create policy "anyone can update a signer" on signers for update using (true);

create policy "card objects are publicly readable" on card_objects for select using (true);
create policy "anyone can add a card object" on card_objects for insert with check (true);
create policy "anyone can update a card object" on card_objects for update using (true);
create policy "anyone can delete a card object" on card_objects for delete using (true);

-- RLS policies only take effect on top of baseline role privileges — the
-- anon/authenticated roles also need table-level grants (Supabase projects
-- usually set these up by default, but grant explicitly so this migration
-- doesn't depend on that).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on cards, signers, card_objects to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Storage — uploaded photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('card-photos', 'card-photos', true)
on conflict (id) do nothing;

create policy "card photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'card-photos');

create policy "anyone can upload a card photo"
  on storage.objects for insert
  with check (bucket_id = 'card-photos');

create policy "anyone can update a card photo"
  on storage.objects for update
  using (bucket_id = 'card-photos');
