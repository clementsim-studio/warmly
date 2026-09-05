-- Schedule purge-expired-cards to run once a day.
--
-- pg_cron fires the schedule; pg_net (net.http_post) makes the HTTPS call to
-- the Edge Function. The service-role key is read from Supabase Vault at
-- call time, never written into the cron command in plaintext.
--
-- PREREQUISITES — do these first, in order:
--
--   1. Deploy the function (from the repo root):
--        supabase functions deploy purge-expired-cards
--      Leave JWT verification ON (the default): the cron call below sends
--      the service-role key as the bearer token, which satisfies both the
--      platform gateway and the function's own auth check.
--
--   2. Store two secrets in Vault (Supabase SQL Editor — replace the values):
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<service-role-key>',                'service_role_key');
--      Confirm with:  select name from vault.secrets;
--
--   3. Then run this migration.
--
-- Re-running this migration is safe: the unschedule step is guarded.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  perform cron.unschedule('purge-expired-cards');
exception when others then
  null; -- not scheduled yet — fine
end $$;

-- 03:15 UTC daily. The card has been frozen since day 14, so no one is
-- mid-edit at purge time; the exact minute only matters for spreading load.
select cron.schedule(
  'purge-expired-cards',
  '15 3 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/purge-expired-cards',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'service_role_key'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- --- inspecting it later --------------------------------------------------
--   select * from cron.job where jobname = 'purge-expired-cards';
--
--   select status, return_message, start_time, end_time
--   from   cron.job_run_details
--   where  jobid = (select jobid from cron.job where jobname = 'purge-expired-cards')
--   order  by start_time desc
--   limit  20;
--
-- The function's own logs (Supabase dashboard -> Edge Functions ->
-- purge-expired-cards -> Logs) show the JSON result: purged / photosDeleted
-- / more. A `"more": true` means there was a backlog larger than one batch
-- — invoke the function again manually, or just let the next daily run take
-- the rest.
