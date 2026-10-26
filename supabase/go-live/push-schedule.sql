-- Schedules the push sender: once a minute, if anything is waiting in push_outbox, call the send-push Edge Function.
--
-- This is NOT a numbered migration on purpose. It needs the pg_cron, pg_net and Vault features of a real Supabase
-- project, which the plain-Postgres test database does not have, and it is a production switch that should be
-- thrown deliberately, after migration 0020 is applied, the function is deployed and the checklist in
-- docs/PUSH_GO_LIVE.md has been followed. Run it in the Supabase SQL editor.
--
-- Before running it, store the shared secret in Vault (the same value as the function's PUSH_SECRET). Run this once by
-- hand with your own value, and never commit it:
--     select vault.create_secret('<the same long random string as PUSH_SECRET>', 'push_secret');
-- To change it later: select vault.update_secret(id, '<new value>') from vault.secrets where name = 'push_secret';

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Re-running replaces the job of the same name. The WHERE EXISTS keeps an idle minute from calling the function at
-- all (about 1,440 calls a day saved), and the secret is read from Vault at run time, so it never sits in the job text.
select cron.schedule(
  'send-push',
  '* * * * *',
  $job$
  select net.http_post(
    url := 'https://ygewircfvsadazpwxquv.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'push_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
  where exists (select 1 from public.push_outbox where sent_at is null)
  $job$
);

-- Check on it (each returns recent rows):
--   select jobid, jobname, schedule, active from cron.job where jobname = 'send-push';
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 10;
--   select status_code, left(content, 200) as answer, created from net._http_response order by created desc limit 10;
