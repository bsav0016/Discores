-- Tests for migration 0026 (client_events and log_client_event). Each block raises on the first failed assertion.
\set ON_ERROR_STOP on

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;
create or replace function pg_temp.make_user(name text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, name || '@example.com',
          jsonb_build_object('display_name', name, 'birth_year', 1990, 'age_confirmed', 'true'));
  return uid;
end $$;
create or replace function pg_temp.assert(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
end $$;

-- 1. A signed-in person can log; the row holds only the reported fields; bad input is refused, not raised.
do $$
declare a uuid := pg_temp.make_user('ev_a'); r text;
begin
  delete from client_events;
  perform pg_temp.as_user(a);
  perform pg_temp.assert(log_client_event('sync', 'sync.rejected', 'round belongs to another user', '1.1.0', 'ios') = 'ok', 'ok');
  perform pg_temp.assert((select count(*) from client_events) = 1, 'one row');
  perform pg_temp.assert((select message from client_events) = 'round belongs to another user', 'message kept');
  perform pg_temp.assert(log_client_event('nope', 'x', '', '', 'ios') = 'invalid', 'bad kind');
  perform pg_temp.assert(log_client_event('error', 'Has Space', '', '', 'ios') = 'invalid', 'bad code');
  perform pg_temp.assert(log_client_event('error', repeat('a', 65), '', '', 'ios') = 'invalid', 'long code');
  perform pg_temp.assert(log_client_event('error', 'ok', '', '', 'web') = 'invalid', 'bad platform');
  perform pg_temp.assert(log_client_event('error', null, '', '', 'ios') = 'invalid', 'null code');
  perform pg_temp.assert((select count(*) from client_events) = 1, 'invalid rows not stored');
  -- long text is cut, not refused
  perform pg_temp.assert(log_client_event('error', 'long', repeat('x', 500), repeat('9', 50), 'android') = 'ok', 'long text ok');
  perform pg_temp.assert((select max(char_length(message)) from client_events) = 200, 'message cut to 200');
  perform pg_temp.assert((select max(char_length(app_version)) from client_events) = 20, 'version cut to 20');
  -- the table has no column that could identify a person
  perform pg_temp.assert(not exists (select 1 from information_schema.columns where table_name = 'client_events'
    and column_name in ('user_id', 'device_id', 'ip', 'round_id')), 'no identifying columns');
  delete from client_events;
  delete from auth.users where id = a;
end $$;

-- 2. Guests and signed-out callers cannot log, and nobody can read or write the tables directly.
do $$
declare a uuid := pg_temp.make_user('ev_b'); failed boolean := false;
begin
  perform pg_temp.as_user(null);
  begin perform log_client_event('error', 'x', '', '', 'ios'); exception when others then failed := true; end;
  perform pg_temp.assert(failed, 'needs sign-in');
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.client_events', 'select'), 'no select');
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.client_events', 'insert'), 'no insert');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.client_events', 'select'), 'anon no select');
  perform pg_temp.assert(not has_function_privilege('anon', 'public.log_client_event(text,text,text,text,text)', 'execute'), 'anon cannot call');
  perform pg_temp.assert(not has_function_privilege('authenticated', 'public.purge_client_events(integer)', 'execute'), 'purge is internal');
  delete from auth.users where id = a;
end $$;

-- 3. Rate limit: 20 per person per hour, per person (someone else is unaffected).
do $$
declare a uuid := pg_temp.make_user('ev_c'); b uuid := pg_temp.make_user('ev_d'); i int; r text;
begin
  delete from client_events;
  perform pg_temp.as_user(a);
  for i in 1..20 loop
    perform pg_temp.assert(log_client_event('error', 'spam', '', '', 'ios') = 'ok', 'within limit ' || i);
  end loop;
  perform pg_temp.assert(log_client_event('error', 'spam', '', '', 'ios') = 'limited', '21st is limited');
  perform pg_temp.assert((select count(*) from client_events) = 20, 'limited event not stored');
  perform pg_temp.as_user(b);
  perform pg_temp.assert(log_client_event('error', 'other', '', '', 'ios') = 'ok', 'other person unaffected');
  -- a new hour starts fresh
  update client_event_limits set hour = hour - interval '1 hour' where user_id = a;
  perform pg_temp.as_user(a);
  perform pg_temp.assert(log_client_event('error', 'again', '', '', 'ios') = 'ok', 'next hour ok');
  delete from client_events;
  delete from auth.users where id in (a, b);
end $$;

-- 4. Total cap, and 30-day retention (purged on write).
do $$
declare a uuid := pg_temp.make_user('ev_e');
begin
  delete from client_events;
  insert into client_events (kind, code, platform) select 'error', 'fill', 'ios' from generate_series(1, 20000);
  perform pg_temp.as_user(a);
  perform pg_temp.assert(log_client_event('error', 'full', '', '', 'ios') = 'limited', 'log full');
  delete from client_events;

  insert into client_events (created_at, kind, code, platform)
  values (now() - interval '31 days', 'error', 'old', 'ios'), (now() - interval '29 days', 'error', 'recent', 'ios');
  perform pg_temp.assert(log_client_event('error', 'new', '', '', 'ios') = 'ok', 'logs');
  perform pg_temp.assert(not exists (select 1 from client_events where code = 'old'), 'old purged');
  perform pg_temp.assert(exists (select 1 from client_events where code = 'recent'), 'recent kept');
  perform pg_temp.assert(purge_client_events() = 0, 'nothing more to purge');
  delete from client_events;
  delete from auth.users where id = a;
end $$;

-- 5. Deleting the account removes the person's counters and leaves no event to trace.
do $$
declare a uuid := pg_temp.make_user('ev_f');
begin
  delete from client_events;
  perform pg_temp.as_user(a);
  perform pg_temp.assert(log_client_event('error', 'mine', '', '', 'ios') = 'ok', 'logs');
  perform pg_temp.assert(exists (select 1 from client_event_limits where user_id = a), 'counter exists');
  perform delete_account();
  perform pg_temp.assert(not exists (select 1 from client_event_limits where user_id = a), 'counter deleted with account');
  perform pg_temp.assert((select count(*) from client_events) = 1, 'event is anonymous and stays until retention');
  delete from client_events;
end $$;
