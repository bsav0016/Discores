-- Stops the push sender and clears what it was working on. Safe to run at any time; the app keeps working without it
-- (people simply stop getting notifications). Run in the Supabase SQL editor.

select cron.unschedule('send-push');

-- Optional, to also forget everything: queued notifications and every registered phone.
-- delete from public.push_outbox;
-- delete from public.push_tokens;

-- Optional: drop the stored secret (rotate PUSH_SECRET on the function too).
-- delete from vault.secrets where name = 'push_secret';
