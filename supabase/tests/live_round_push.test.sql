-- Tests for migration 0029 (a friend is told when added to a round in progress). Run by supabase/tests/run.sh.
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

create or replace function pg_temp.make_layout() returns uuid language plpgsql as $$
declare cid uuid := gen_random_uuid(); lid uuid := gen_random_uuid();
begin
  insert into courses (id, name) values (cid, 'Test Course ' || cid);
  insert into course_layouts (id, course_id, hole_count) values (lid, cid, 1);
  insert into holes (layout_id, number, par) values (lid, 1, 3);
  return lid;
end $$;

create or replace function pg_temp.tok() returns text language sql as $$
  select 'ExponentPushToken[' || replace(gen_random_uuid()::text, '-', '') || ']'
$$;

create or replace function pg_temp.befriend(a uuid, b uuid) returns void language plpgsql as $$
begin
  insert into friendships (requester, addressee, status) values (a, b, 'accepted');
end $$;

create or replace function pg_temp.seat(rid uuid, u uuid) returns uuid language sql as $$
  select coalesce((select id from round_players where round_id = rid and user_id = u), gen_random_uuid())
$$;

create or replace function pg_temp.sync(rid uuid, lid uuid, scorer uuid, fin timestamptz, others uuid[],
                                        started timestamptz default now()) returns void
language plpgsql as $$
declare players jsonb := jsonb_build_array(jsonb_build_object('id', pg_temp.seat(rid, scorer), 'user_id', scorer, 'position', 0));
        o uuid; i int := 1;
begin
  perform pg_temp.as_user(scorer);
  foreach o in array coalesce(others, '{}') loop
    players := players || jsonb_build_array(jsonb_build_object('id', pg_temp.seat(rid, o), 'user_id', o, 'position', i));
    i := i + 1;
  end loop;
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', started, 'finished_at', fin),
    'players', players, 'scores', '[]'::jsonb));
end $$;

create or replace function pg_temp.count(uid uuid, k text) returns int language sql as $$
  select count(*)::int from push_outbox where user_id = uid and kind = k
$$;

-- 1. A friend is told once when added to a round in progress, the scorer and guests are not, and syncing again
-- (even after the round finishes) queues nothing extra for round_live.
do $$
declare
  scorer uuid := pg_temp.make_user('lp_scorer'); f1 uuid := pg_temp.make_user('lp_f1');
  f2 uuid := pg_temp.make_user('lp_f2'); lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
begin
  perform pg_temp.befriend(scorer, f1); perform pg_temp.befriend(scorer, f2);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(f2); perform register_push_token(pg_temp.tok(), 'ios'); perform set_notification_settings(true, false);
  perform pg_temp.as_user(scorer); perform register_push_token(pg_temp.tok(), 'ios');

  perform pg_temp.sync(rid, lid, scorer, null, array[f1, f2]);
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'friend is told about a round in progress');
  perform pg_temp.assert((select actor_id from push_outbox where user_id = f1 and kind = 'round_live') = scorer, 'owner is the actor');
  perform pg_temp.assert(pg_temp.count(f2, 'round_live') = 0, 'a friend with rounds notifications off is not told');
  perform pg_temp.assert(pg_temp.count(scorer, 'round_live') = 0, 'the owner is not told');
  perform pg_temp.assert(pg_temp.count(f1, 'round_to_confirm') = 0, 'nothing to confirm while it is in progress');

  perform pg_temp.sync(rid, lid, scorer, null, array[f1, f2]);
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'syncing again does not tell them twice');

  -- Finishing without the friend ever joining still asks them to confirm, as before.
  perform pg_temp.sync(rid, lid, scorer, now(), array[f1, f2]);
  perform pg_temp.assert(pg_temp.count(f1, 'round_to_confirm') = 1, 'a friend who never joined is asked to confirm');
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'still one round_live');
end $$;

-- 2. A friend who plays along is not asked to confirm afterwards.
do $$
declare
  scorer uuid := pg_temp.make_user('lq_scorer'); f1 uuid := pg_temp.make_user('lq_f1');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
begin
  perform pg_temp.befriend(scorer, f1);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.sync(rid, lid, scorer, null, array[f1]);
  perform pg_temp.as_user(f1);
  perform sync_my_seat(rid, jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 3, 'updated_at', now())));
  perform pg_temp.sync(rid, lid, scorer, now(), array[f1]);
  perform pg_temp.assert(pg_temp.count(f1, 'round_to_confirm') = 0, 'a friend who played along is not asked to confirm');
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'but they were told it was live');
end $$;

-- 3. Blocks, guests, an old round, and a friend without a phone queue nothing.
do $$
declare
  scorer uuid := pg_temp.make_user('lr_scorer'); f1 uuid := pg_temp.make_user('lr_f1');
  f2 uuid := pg_temp.make_user('lr_f2'); f3 uuid := pg_temp.make_user('lr_f3');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid(); rid2 uuid := gen_random_uuid();
begin
  perform pg_temp.befriend(scorer, f1); perform pg_temp.befriend(scorer, f2); perform pg_temp.befriend(scorer, f3);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(f2); perform register_push_token(pg_temp.tok(), 'ios');
  -- f3 has no phone registered.
  perform pg_temp.as_user(f2); perform block_user(scorer);                    -- blocking also ends the friendship
  perform pg_temp.befriend(scorer, f2);                                       -- but suppose they became friends again
  perform pg_temp.sync(rid, lid, scorer, null, array[f1, f2, f3]);
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'the friend who can be told is told');
  perform pg_temp.assert(pg_temp.count(f2, 'round_live') = 0, 'a blocked pair is not told');
  perform pg_temp.assert(pg_temp.count(f3, 'round_live') = 0, 'no phone, no message');

  perform pg_temp.sync(rid2, lid, scorer, null, array[f1], now() - interval '2 days');
  perform pg_temp.assert(pg_temp.count(f1, 'round_live') = 1, 'a round started two days ago is not live');
end $$;

select 'live_round_push: all tests passed' as result;
