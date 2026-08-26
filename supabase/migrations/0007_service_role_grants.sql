-- Fixes: api/feedback.js's Supabase call (using the service-role key) was
-- failing with `permission denied for table signers` (42501).
--
-- Root cause: migration 0001_init.sql granted table privileges to
-- anon/authenticated only — service_role was never mentioned. RLS-bypass
-- and base table grants are two independent layers in Postgres; service_role
-- bypassing RLS (it does, by default) says nothing about whether it also
-- holds the underlying SELECT/INSERT/UPDATE/DELETE grant on a given table,
-- and this project's Supabase instance doesn't grant that automatically.
-- Same category of gotcha as the original anon-role GRANT issue noted in
-- migration 0001's own comments.
--
-- Two parts: (1) grants on every table that exists today, so the fix is
-- immediate, and (2) an ALTER DEFAULT PRIVILEGES rule so any table created
-- from now on in the public schema grants service_role access automatically
-- — without this, the exact same bug would resurface the next time any
-- serverless function needs a new table.
--
-- Run this once in the Supabase SQL Editor for this project.

grant usage on schema public to service_role;
grant select, insert, update, delete on cards, signers, card_objects, feedback to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
