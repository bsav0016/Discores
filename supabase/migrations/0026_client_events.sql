-- First-party error log. The app reports a failure (a crash, a sync the server refused) as one small row so the owner
-- can see what is going wrong in production without a third-party SDK.
--
-- Privacy by construction:
--   * a row has NO user id, device id, IP or round/course data: only a short error code, a short message the app has
--     already scrubbed, the app version and the platform;
--   * only signed-in people can report, which makes the rate limit per person (an anonymous endpoint can only be
--     limited globally). Guests' failures are not reported;
--   * rows are deleted after 30 days;
--   * the per-person counters live in a separate table that is deleted with the account, so nothing in the event
--     table can be traced back to anyone, and deleting an account needs no change to it.
-- Nobody can read the table through the API; the admin summary (a later migration) reads it through a function.

create table public.client_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('error', 'crash', 'sync')),
  code text not null check (code ~ '^[a-z0-9_.:-]{1,64}$'),
  message text not null default '' check (char_length(message) <= 200),
  app_version text not null default '' check (char_length(app_version) <= 20),
  platform text not null check (platform in ('ios', 'android'))
);
create index client_events_created_at_idx on public.client_events (created_at);
create index client_events_code_idx on public.client_events (code, created_at);
alter table public.client_events enable row level security;
revoke all on public.client_events from public, anon, authenticated;

-- Reports per person per hour. Kept apart from the events so the events stay anonymous.
create table public.client_event_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  hour timestamptz not null,
  n integer not null default 0,
  primary key (user_id, hour)
);
alter table public.client_event_limits enable row level security;
revoke all on public.client_event_limits from public, anon, authenticated;

-- Deletes events older than 30 days (and spent counters). Called from log_client_event so retention holds without a
-- scheduler; supabase/go-live/events-purge-schedule.sql can also run it daily.
create or replace function public.purge_client_events(p_limit integer default 500) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with old as (
    select id from client_events where created_at < now() - interval '30 days' order by created_at limit greatest(p_limit, 1)
  )
  delete from client_events e using old where e.id = old.id;
  get diagnostics n = row_count;
  delete from client_event_limits where hour < now() - interval '2 days';
  return n;
end $$;
revoke all on function public.purge_client_events(integer) from public, anon, authenticated;

-- Records one event. Returns 'ok', 'limited' (this person sent 20 in the past hour, or the log is full) or
-- 'invalid' (a field is out of range). It never raises for bad content, so a broken client cannot loop on errors.
-- Size is capped three ways: field lengths (table checks, plus the truncation below), 20 events per person per
-- hour, and 20,000 rows in total.
create or replace function public.log_client_event(
  p_kind text, p_code text, p_message text default '', p_app_version text default '', p_platform text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  h timestamptz := date_trunc('hour', now());
  used integer;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_kind is null or p_kind not in ('error', 'crash', 'sync')
     or p_code is null or p_code !~ '^[a-z0-9_.:-]{1,64}$'
     or p_platform is null or p_platform not in ('ios', 'android') then
    return 'invalid';
  end if;

  perform purge_client_events(50);

  insert into client_event_limits (user_id, hour, n) values (uid, h, 1)
  on conflict (user_id, hour) do update set n = client_event_limits.n + 1
  returning n into used;
  if used > 20 then return 'limited'; end if;

  if (select count(*) from client_events) >= 20000 then return 'limited'; end if;

  insert into client_events (kind, code, message, app_version, platform)
  values (p_kind, p_code, left(coalesce(p_message, ''), 200), left(coalesce(p_app_version, ''), 20), p_platform);
  return 'ok';
end $$;
revoke all on function public.log_client_event(text, text, text, text, text) from public, anon;
grant execute on function public.log_client_event(text, text, text, text, text) to authenticated;
