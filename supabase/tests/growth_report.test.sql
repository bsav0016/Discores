-- Tests for migration 0030 (the weekly growth report). Run by supabase/tests/run.sh after every migration.
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

create or replace function pg_temp.refused(k text) returns boolean language plpgsql as $$
begin
  perform growth_report(k);
  return false;
exception when others then
  return sqlerrm = 'not allowed';
end $$;

do $$
declare
  key text := 'a-long-random-test-key-0123456789';
  before jsonb; after jsonb; report jsonb;
  a uuid; b uuid; lid uuid := gen_random_uuid(); cid uuid := gen_random_uuid();
  rid uuid := gen_random_uuid();
begin
  -- No key stored: nothing is allowed, whatever is sent.
  perform pg_temp.assert(pg_temp.refused(key), 'refused while no key is stored');
  perform pg_temp.assert(pg_temp.refused(null), 'refused for a null key');
  perform pg_temp.assert(pg_temp.refused(''), 'refused for an empty key');

  insert into growth_report_key (hash) values (encode(sha256(convert_to(key, 'utf8')), 'hex'));
  perform pg_temp.assert(pg_temp.refused('another-long-random-wrong-key-1234'), 'a wrong key is refused');
  perform pg_temp.assert(pg_temp.refused('short'), 'a short key is refused');

  before := growth_report(key);
  perform pg_temp.assert(before ? 'accounts' and before ? 'rounds' and before ? 'players' and before ? 'friends'
                         and before ? 'notifications' and before ? 'courses' and before ? 'errors', 'every section is present');

  a := pg_temp.make_user('growth_alpha'); b := pg_temp.make_user('growth_bravo');
  insert into friendships (requester, addressee, status) values (a, b, 'accepted');
  insert into courses (id, name, source) values (cid, 'Growth Test Course', 'user');
  insert into course_layouts (id, course_id, hole_count, verified) values (lid, cid, 1, true);
  insert into holes (layout_id, number, par) values (lid, 1, 3);
  perform pg_temp.as_user(a);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', now()),
    'players', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'user_id', a, 'position', 0),
                                 jsonb_build_object('id', gen_random_uuid(), 'user_id', b, 'position', 1)),
    'scores', '[]'::jsonb));
  insert into client_events (kind, code, platform) values ('error', 'growth_test', 'ios');

  after := growth_report(key);
  perform pg_temp.assert((after #>> '{accounts,new_this_week}')::int = (before #>> '{accounts,new_this_week}')::int + 2, 'two new accounts');
  perform pg_temp.assert((after #>> '{accounts,total}')::int = (before #>> '{accounts,total}')::int + 2, 'accounts total');
  perform pg_temp.assert((after #>> '{rounds,started_this_week}')::int = (before #>> '{rounds,started_this_week}')::int + 1, 'one round');
  perform pg_temp.assert((after #>> '{rounds,finished_this_week}')::int = (before #>> '{rounds,finished_this_week}')::int + 1, 'one finished round');
  perform pg_temp.assert((after #>> '{rounds,with_friends_this_week}')::int = (before #>> '{rounds,with_friends_this_week}')::int + 1, 'a round with two registered players');
  perform pg_temp.assert((after #>> '{players,active_this_week}')::int = (before #>> '{players,active_this_week}')::int + 2, 'two active players');
  perform pg_temp.assert((after #>> '{friends,accepted_new_this_week}')::int = (before #>> '{friends,accepted_new_this_week}')::int + 1, 'one new friendship');
  perform pg_temp.assert((after #>> '{courses,confirmed_pars}')::int = (before #>> '{courses,confirmed_pars}')::int + 1, 'one confirmed course');
  perform pg_temp.assert((after #>> '{courses,added_by_players_this_week}')::int = (before #>> '{courses,added_by_players_this_week}')::int + 1, 'one player-added course');
  perform pg_temp.assert((after #>> '{errors,this_week}')::int = (before #>> '{errors,this_week}')::int + 1, 'one error');

  -- Old activity moves to the previous week and out of this week's counts.
  update rounds set started_at = now() - interval '10 days' where id = rid;
  report := growth_report(key);
  perform pg_temp.assert((report #>> '{rounds,started_this_week}')::int = (before #>> '{rounds,started_this_week}')::int, 'the old round left this week');
  perform pg_temp.assert((report #>> '{rounds,started_prev_week}')::int = (before #>> '{rounds,started_prev_week}')::int + 1, 'and counts for the week before');

  -- Only numbers and a timestamp: no names, emails or ids come back.
  perform pg_temp.assert(report::text not like '%growth_alpha%' and report::text not like '%example.com%'
                         and report::text not like '%' || a::text || '%', 'nothing identifies a person');
  perform pg_temp.assert(not exists (
    select 1 from jsonb_each(report) s, jsonb_each(case when jsonb_typeof(s.value) = 'object' then s.value else '{}'::jsonb end) v
    where jsonb_typeof(v.value) <> 'number'), 'every value inside a section is a number');
end $$;

select 'growth_report: all tests passed' as result;
