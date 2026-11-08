-- Optional: also purge the error log (rows older than 30 days) once a day. Events are purged whenever one is logged,
-- so this only matters if nobody reports for a long time. Needs the pg_cron extension (Database > Extensions).
-- Run in the Supabase SQL editor. Undo with: select cron.unschedule('purge-client-events');

select cron.schedule('purge-client-events', '17 3 * * *', $$ select public.purge_client_events(100000) $$);
