-- Tests for migration 0028 (friends score together live). Run by supabase/tests/run.sh after every migration.
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

-- The owner's push: seats as given, scores as [{seat, hole, strokes, at}].
create or replace function pg_temp.owner_push(rid uuid, lid uuid, seats jsonb, owner_scores jsonb, fin timestamptz default null)
returns void language plpgsql as $$
begin
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', fin),
    'players', seats,
    'scores', (select coalesce(jsonb_agg(jsonb_build_object('round_player_id', s ->> 'seat', 'hole_number', (s ->> 'hole')::int,
                                                            'strokes', (s ->> 'strokes')::int, 'updated_at', s ->> 'at')),
                               '[]'::jsonb)
               from jsonb_array_elements(owner_scores) s)));
end $$;

create or replace function pg_temp.seat_scores(seat uuid) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(hole_number::text, strokes), '{}'::jsonb) from scores where round_player_id = seat
$$;

-- 1. A friend in an unfinished round sees it, writes only their own seat, and the owner sees the friend's score.
do $$
declare
  brian uuid := pg_temp.make_user('live_brian1'); john uuid := pg_temp.make_user('live_john1');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); pg uuid := gen_random_uuid();
  seats jsonb; live jsonb; res text;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  seats := jsonb_build_array(
    jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
    jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
    jsonb_build_object('id', pg, 'guest_name', 'Gus', 'position', 2));
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, seats,
    jsonb_build_array(jsonb_build_object('seat', pb, 'hole', 1, 'strokes', 3, 'at', now() - interval '5 minutes'),
                      jsonb_build_object('seat', pj, 'hole', 1, 'strokes', 5, 'at', now() - interval '5 minutes')));

  -- John sees the unfinished round with every seat, and is not yet confirmed (the owner scored his seat).
  perform pg_temp.as_user(john);
  live := list_live_rounds();
  perform pg_temp.assert(jsonb_array_length(live) = 1 and (live -> 0 ->> 'id')::uuid = rid, 'friend lists the live round');
  perform pg_temp.assert(jsonb_array_length(live -> 0 -> 'players') = 3, 'friend sees every seat');
  perform pg_temp.assert((live -> 0 ->> 'is_owner')::boolean = false and (live -> 0 ->> 'owner_name') = 'live_brian1',
                         'friend is not the owner; owner named');
  perform pg_temp.assert((select bool_or((p ->> 'is_me')::boolean) from jsonb_array_elements(live -> 0 -> 'players') p),
                         'friend finds their own seat');
  perform pg_temp.assert((live -> 0 -> 'players' -> 0 ->> 'user_id')::uuid = brian and (live -> 0 -> 'players' -> 1 ->> 'user_id')::uuid = john
                         and (live -> 0 -> 'players' -> 2 ->> 'user_id') is null, 'friend gets the owner''s and their own ids, not the guest''s');
  perform pg_temp.assert((select confirmed_at is null from round_players where id = pj), 'seat not confirmed before the friend writes');

  -- John fixes his own hole 1 and adds hole 2.
  res := sync_my_seat(rid, jsonb_build_array(
    jsonb_build_object('hole_number', 1, 'strokes', 4, 'updated_at', now()),
    jsonb_build_object('hole_number', 2, 'strokes', 6, 'updated_at', now())));
  perform pg_temp.assert(res = 'ok', 'friend writes own seat');
  perform pg_temp.assert(pg_temp.seat_scores(pj) = '{"1":4,"2":6}', 'friend scores stored');
  perform pg_temp.assert((select confirmed_at is not null from round_players where id = pj), 'writing confirms the seat');
  perform pg_temp.assert(pg_temp.seat_scores(pb) = '{"1":3}' and pg_temp.seat_scores(pg) = '{}', 'others untouched');

  -- The owner's re-push with the old hole-1 value cannot clobber the friend's newer score, but a newer owner entry can.
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, seats,
    jsonb_build_array(jsonb_build_object('seat', pj, 'hole', 1, 'strokes', 5, 'at', now() - interval '5 minutes'),
                      jsonb_build_object('seat', pj, 'hole', 3, 'strokes', 2, 'at', now() - interval '1 minute')));
  perform pg_temp.assert(pg_temp.seat_scores(pj) = '{"1":4,"2":6,"3":2}', 'owner push keeps newer friend score, adds new hole');
  perform pg_temp.assert((select confirmed_at is not null from round_players where id = pj), 'owner push keeps the confirmation');

  -- The owner's phone sees the friend's entries.
  live := list_live_rounds();
  perform pg_temp.assert((live -> 0 ->> 'is_owner')::boolean, 'owner lists own live round');
  perform pg_temp.assert((select s ->> 'strokes' from jsonb_array_elements(live -> 0 -> 'players' -> 1 -> 'scores') s
                          where s ->> 'hole_number' = '2') = '6', 'owner sees the friend''s hole 2');
end $$;

-- 2. Who may not write.
do $$
declare
  brian uuid := pg_temp.make_user('live_brian2'); john uuid := pg_temp.make_user('live_john2');
  sam uuid := pg_temp.make_user('live_sam2'); eve uuid := pg_temp.make_user('live_eve2');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); ps uuid := gen_random_uuid();
  seats jsonb; one jsonb := jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 4, 'updated_at', now()));
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted'), (brian, sam, 'accepted');
  seats := jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                             jsonb_build_object('id', pj, 'user_id', john, 'position', 1));
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, seats, '[]'::jsonb);

  perform pg_temp.as_user(sam);   -- a friend of the owner with no seat
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_found', 'friend without a seat cannot write');
  perform pg_temp.assert(list_live_rounds() = '[]'::jsonb, 'friend without a seat does not see the round');
  perform pg_temp.as_user(eve);   -- a stranger
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_found', 'stranger cannot write');
  perform pg_temp.assert(list_live_rounds() = '[]'::jsonb, 'stranger does not see the round');
  perform pg_temp.as_user(brian); -- the owner uses sync_round
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_found', 'owner does not use sync_my_seat');
  perform pg_temp.as_user(null);
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_signed_in', 'signed-out caller rejected');

  perform pg_temp.as_user(john);
  perform pg_temp.assert(sync_my_seat(gen_random_uuid(), one) = 'not_found', 'unknown round');
  perform pg_temp.assert(sync_my_seat(rid, jsonb_build_array(jsonb_build_object('hole_number', 4, 'strokes', 4))) = 'ok'
                         and pg_temp.seat_scores(pj) = '{}', 'a hole past the round is ignored');
  begin
    perform sync_my_seat(rid, jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 31, 'updated_at', now())));
    perform pg_temp.assert(false, 'strokes out of range should fail');
  exception when check_violation then null;
  end;

  -- A score dated in the future is stored as now(), so a fast clock cannot win every later edit.
  perform sync_my_seat(rid, jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 4,
                                                                 'updated_at', now() + interval '2 days')));
  perform pg_temp.assert((select updated_at <= now() from scores where round_player_id = pj and hole_number = 1),
                         'future timestamps are bounded');

  -- Blocking ends access: the friendship goes, so the friend can neither see nor write.
  perform pg_temp.as_user(brian);
  perform block_user(john);
  perform pg_temp.as_user(john);
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_found', 'blocked friend cannot write');
  perform pg_temp.assert(list_live_rounds() = '[]'::jsonb, 'blocked friend does not see the round');
end $$;

-- 3. A finished round accepts a friend's last scores for an hour, then closes; a finished round drops out of the list
-- after the same hour. A declined seat cannot write.
do $$
declare
  brian uuid := pg_temp.make_user('live_brian3'); john uuid := pg_temp.make_user('live_john3');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid(); rid2 uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); pb2 uuid := gen_random_uuid(); pj2 uuid := gen_random_uuid();
  one jsonb := jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 4, 'updated_at', now()));
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                                                         jsonb_build_object('id', pj, 'user_id', john, 'position', 1)),
                             '[]'::jsonb, now());
  perform pg_temp.as_user(john);
  perform pg_temp.assert(jsonb_array_length(list_live_rounds()) = 1, 'just-finished round still listed');
  perform pg_temp.assert(sync_my_seat(rid, one) = 'ok', 'grace window accepts the last scores');

  perform pg_temp.as_user(brian);
  update rounds set finished_at = now() - interval '2 hours' where id = rid;
  perform pg_temp.as_user(john);
  perform pg_temp.assert(sync_my_seat(rid, one) = 'closed', 'closed after the grace window');
  perform pg_temp.assert(list_live_rounds() = '[]'::jsonb, 'old finished round is not live');

  -- Declining a seat unlinks it, so it cannot write.
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid2, lid, jsonb_build_array(jsonb_build_object('id', pb2, 'user_id', brian, 'position', 0),
                                                          jsonb_build_object('id', pj2, 'user_id', john, 'position', 1)),
                             '[]'::jsonb, now());
  perform pg_temp.as_user(john);
  perform pg_temp.assert(respond_round_confirmation(rid2, false) = 'ok', 'decline works');
  perform pg_temp.assert(sync_my_seat(rid2, one) = 'not_found', 'declined seat cannot write');
end $$;

-- 4. A deleted round (owner removed, tombstone) cannot be written to.
do $$
declare
  brian uuid := pg_temp.make_user('live_brian4'); john uuid := pg_temp.make_user('live_john4');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid();
  one jsonb := jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 4, 'updated_at', now()));
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                                                         jsonb_build_object('id', pj, 'user_id', john, 'position', 1)),
                             '[]'::jsonb);
  perform delete_round(rid);
  perform pg_temp.as_user(john);
  perform pg_temp.assert(sync_my_seat(rid, one) = 'not_found', 'deleted round cannot be written');
  perform pg_temp.assert(list_live_rounds() = '[]'::jsonb, 'deleted round is not live');
end $$;

-- 5. A seat the friend scored does not show up as pending after the round finishes; one they never wrote does.
do $$
declare
  brian uuid := pg_temp.make_user('live_brian5'); john uuid := pg_temp.make_user('live_john5');
  sam uuid := pg_temp.make_user('live_sam5');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); ps uuid := gen_random_uuid();
  seats jsonb;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted'), (brian, sam, 'accepted');
  seats := jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                             jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
                             jsonb_build_object('id', ps, 'user_id', sam, 'position', 2));
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, seats, '[]'::jsonb);
  perform pg_temp.as_user(john);
  perform sync_my_seat(rid, jsonb_build_array(jsonb_build_object('hole_number', 1, 'strokes', 3, 'updated_at', now())));
  perform pg_temp.as_user(brian);
  perform pg_temp.owner_push(rid, lid, seats, '[]'::jsonb, now());
  perform pg_temp.as_user(john);
  perform pg_temp.assert(list_pending_rounds() = '[]'::jsonb, 'friend who played along has nothing to confirm');
  perform pg_temp.assert(jsonb_array_length(pull_shared_rounds()) = 1, 'finished round is in the friend''s history');
  perform pg_temp.as_user(sam);
  perform pg_temp.assert(jsonb_array_length(list_pending_rounds()) = 1, 'friend who never wrote still confirms afterwards');
end $$;

select 'live_rounds: all tests passed' as result;
