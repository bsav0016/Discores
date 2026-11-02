-- Tests for migration 0022 (a round carries its own pars). Run by supabase/tests/run.sh after every migration.
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

-- A three-hole layout, pars 3, 4, 3.
create or replace function pg_temp.make_layout() returns uuid language plpgsql as $$
declare cid uuid := gen_random_uuid(); lid uuid := gen_random_uuid();
begin
  insert into courses (id, name) values (cid, 'Test Course ' || cid);
  insert into course_layouts (id, course_id, hole_count) values (lid, cid, 3);
  insert into holes (layout_id, number, par) values (lid, 1, 3), (lid, 2, 4), (lid, 3, 3);
  return lid;
end $$;

create or replace function pg_temp.push(rid uuid, lid uuid, seat uuid, uid uuid, round_extra jsonb, fin timestamptz default null)
returns void language plpgsql as $$
begin
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', fin) || round_extra,
    'players', jsonb_build_array(jsonb_build_object('id', seat, 'user_id', uid, 'position', 0)),
    'scores', '[]'::jsonb));
end $$;

create or replace function pg_temp.rejects(rid uuid, lid uuid, seat uuid, uid uuid, bad jsonb) returns boolean
language plpgsql as $$
begin
  perform pg_temp.push(rid, lid, seat, uid, jsonb_build_object('pars', bad));
  return false;
exception when others then
  return true;
end $$;

-- An app that sends no pars (an older build) gets the layout's pars copied in once, and a later change to the layout
-- does not touch the round.
do $$
declare
  u uuid := pg_temp.make_user('own_pars_old'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); seat uuid := gen_random_uuid();
begin
  perform pg_temp.as_user(u);
  perform pg_temp.push(rid, lid, seat, u, '{}'::jsonb);
  perform pg_temp.assert((select pars from rounds where id = rid) = '{3,4,3}', 'layout pars copied in on first sight');
  update holes set par = 5 where layout_id = lid and number = 1;     -- the course is corrected later
  perform pg_temp.push(rid, lid, seat, u, '{}'::jsonb);              -- and the old app syncs again
  perform pg_temp.assert((select pars from rounds where id = rid) = '{3,4,3}', 'a later layout change does not rewrite the round');
  perform pg_temp.assert((pull_my_rounds() -> 'rounds' -> 0 -> 'pars') = '[3,4,3]'::jsonb, 'pull_my_rounds returns the round''s pars');
end $$;

-- An app that sends its own pars: stored, the length is the hole count, and a later sync can change them.
do $$
declare
  u uuid := pg_temp.make_user('own_pars_new'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); seat uuid := gen_random_uuid(); got jsonb;
begin
  perform pg_temp.as_user(u);
  perform pg_temp.push(rid, lid, seat, u, jsonb_build_object('pars', jsonb_build_array(4, 3, 3, 5)));
  perform pg_temp.assert((select pars from rounds where id = rid) = '{4,3,3,5}', 'the round''s own pars are stored');
  got := pull_my_rounds() -> 'rounds' -> 0;
  perform pg_temp.assert(got -> 'pars' = '[4,3,3,5]'::jsonb and (got ->> 'hole_count')::int = 4,
                         'pars and hole count come back from the round, not the layout');
  perform pg_temp.push(rid, lid, seat, u, jsonb_build_object('pars', jsonb_build_array(4, 3, 3, 5, 4)));
  perform pg_temp.assert((select pars from rounds where id = rid) = '{4,3,3,5,4}', 'the owner can change the pars later');
  perform pg_temp.push(rid, lid, seat, u, '{}'::jsonb);
  perform pg_temp.assert((select pars from rounds where id = rid) = '{4,3,3,5,4}', 'a sync without pars keeps them');
  perform pg_temp.assert((select count(*) from course_layouts where id = lid and hole_count = 3) = 1, 'the course itself is untouched');
end $$;

-- Bad pars are refused, and nothing is stored.
do $$
declare
  u uuid := pg_temp.make_user('own_pars_bad'); lid uuid := pg_temp.make_layout();
begin
  perform pg_temp.as_user(u);
  perform pg_temp.assert(pg_temp.rejects(gen_random_uuid(), lid, gen_random_uuid(), u, '[]'::jsonb), 'no holes refused');
  perform pg_temp.assert(pg_temp.rejects(gen_random_uuid(), lid, gen_random_uuid(), u, '[1,3]'::jsonb), 'par 1 refused');
  perform pg_temp.assert(pg_temp.rejects(gen_random_uuid(), lid, gen_random_uuid(), u, '[3,7]'::jsonb), 'par 7 refused');
  perform pg_temp.assert(pg_temp.rejects(gen_random_uuid(), lid, gen_random_uuid(), u,
                                         (select jsonb_agg(3) from generate_series(1, 37))), '37 holes refused');
  perform pg_temp.assert(pg_temp.rejects(gen_random_uuid(), lid, gen_random_uuid(), u, '[3,null]'::jsonb), 'a missing par refused');
  perform pg_temp.assert(not exists (select 1 from rounds where created_by = u), 'nothing stored');
end $$;

-- A friend sees the round's own pars in the pending list and in their history; a round row with no pars of its own
-- (null) falls back to the layout.
do $$
declare
  scorer uuid := pg_temp.make_user('own_pars_scorer'); friend uuid := pg_temp.make_user('own_pars_friend');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); got jsonb; r2 uuid := gen_random_uuid();
begin
  insert into friendships (requester, addressee, status) values (scorer, friend, 'accepted');
  perform pg_temp.as_user(scorer);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', now(),
                                'pars', jsonb_build_array(5, 5)),
    'players', jsonb_build_array(jsonb_build_object('id', s1, 'user_id', scorer, 'position', 0),
                                 jsonb_build_object('id', s2, 'user_id', friend, 'position', 1)),
    'scores', '[]'::jsonb));

  perform pg_temp.as_user(friend);
  got := list_pending_rounds() -> 0;
  perform pg_temp.assert(got -> 'pars' = '[5,5]'::jsonb and (got ->> 'hole_count')::int = 2, 'pending list shows the round''s pars');
  perform pg_temp.assert(respond_round_confirmation(rid, true) = 'ok', 'friend confirms');
  got := pull_shared_rounds() -> 0;
  perform pg_temp.assert(got -> 'pars' = '[5,5]'::jsonb and (got ->> 'hole_count')::int = 2, 'shared history shows the round''s pars');

  -- A row that has no pars of its own still reads from the layout.
  perform pg_temp.as_user(scorer);
  insert into rounds (id, layout_id, created_by, started_at) values (r2, lid, scorer, now() - interval '1 day');
  insert into round_players (id, round_id, user_id, position, confirmed_at) values (gen_random_uuid(), r2, scorer, 0, now());
  got := (select x from jsonb_array_elements(pull_my_rounds() -> 'rounds') x where (x ->> 'id')::uuid = r2);
  perform pg_temp.assert(got -> 'pars' = '[3,4,3]'::jsonb and (got ->> 'hole_count')::int = 3, 'no own pars: falls back to the layout');
end $$;

-- The check constraint backs the function up.
do $$
declare u uuid := pg_temp.make_user('own_pars_check'); lid uuid := pg_temp.make_layout();
begin
  begin
    insert into rounds (id, layout_id, created_by, started_at, pars) values (gen_random_uuid(), lid, u, now(), '{3,9}');
    raise exception 'FAILED: par 9 should have been refused by the constraint';
  exception when check_violation then null;
  end;
end $$;

select 'round_own_pars: all tests passed' as result;
