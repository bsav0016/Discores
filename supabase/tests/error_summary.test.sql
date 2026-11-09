-- Tests for migration 0027 (list_error_summary).
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

do $$
declare adm uuid := pg_temp.make_user('sum_admin'); usr uuid := pg_temp.make_user('sum_user'); failed boolean := false;
begin
  delete from client_events;
  insert into admins (user_id) values (adm);
  insert into client_events (kind, code, message, app_version, platform, created_at) values
    ('sync', 'sync.rejected', 'first', '1.1.0', 'ios', now() - interval '2 days'),
    ('sync', 'sync.rejected', 'latest', '1.1.0', 'ios', now() - interval '1 hour'),
    ('sync', 'sync.rejected', 'android', '1.1.0', 'android', now()),
    ('crash', 'render.boundary', 'boom', '1.1.0', 'ios', now()),
    ('error', 'old', 'outside window', '1.0.1', 'ios', now() - interval '20 days');

  -- a non-admin and a signed-out caller are refused
  perform pg_temp.as_user(usr);
  begin perform * from list_error_summary(); exception when others then failed := true; end;
  perform pg_temp.assert(failed, 'non-admin refused');
  perform pg_temp.as_user(null);
  failed := false;
  begin perform * from list_error_summary(); exception when others then failed := true; end;
  perform pg_temp.assert(failed, 'signed-out refused');
  perform pg_temp.assert(not has_function_privilege('anon', 'public.list_error_summary(integer)', 'execute'), 'anon cannot call');

  perform pg_temp.as_user(adm);
  perform pg_temp.assert((select count(*) from list_error_summary(7)) = 3, 'three groups in 7 days');
  perform pg_temp.assert((select n from list_error_summary(7) where code = 'sync.rejected' and platform = 'ios') = 2, 'counts a group');
  perform pg_temp.assert((select sample from list_error_summary(7) where code = 'sync.rejected' and platform = 'ios') = 'latest', 'newest sample');
  perform pg_temp.assert((select code from list_error_summary(7) limit 1) = 'sync.rejected', 'most frequent first');
  perform pg_temp.assert((select count(*) from list_error_summary(30)) = 4, 'longer window includes older');
  perform pg_temp.assert((select count(*) from list_error_summary(1000)) = 4, 'days capped at 30');
  perform pg_temp.assert((select count(*) from list_error_summary(null)) = 3, 'null means 7 days');

  delete from client_events;
  delete from admins where user_id = adm;
  delete from auth.users where id in (adm, usr);
end $$;
