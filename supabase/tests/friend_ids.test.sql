-- Tests for migration 0031 (friends' account ids in shared and live rounds). Run by supabase/tests/run.sh.
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

-- 1. pull_shared_rounds: your own id and an accepted friend's; nobody else's.
do $$
declare
  brian uuid := pg_temp.make_user('fid_brian'); john uuid := pg_temp.make_user('fid_john');
  sam uuid := pg_temp.make_user('fid_sam'); lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); ps uuid := gen_random_uuid(); pg uuid := gen_random_uuid();
  seats jsonb; players jsonb;
begin
  -- Brian owns the round with John, Sam and a guest. Brian is friends with both; John and Sam are strangers.
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted'), (brian, sam, 'accepted');
  seats := jsonb_build_array(
    jsonb_build_object('id', pb, 'user_id', brian, 'position', 0), jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
    jsonb_build_object('id', ps, 'user_id', sam, 'position', 2), jsonb_build_object('id', pg, 'guest_name', 'Gus', 'position', 3));
  perform pg_temp.as_user(brian);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now() - interval '1 hour', 'finished_at', now()),
    'players', seats, 'scores', '[]'::jsonb));
  update round_players set confirmed_at = now() where id in (pj, ps);

  perform pg_temp.as_user(john);
  players := pull_shared_rounds() -> 0 -> 'players';
  perform pg_temp.assert(jsonb_array_length(players) = 4, 'John sees every seat');
  perform pg_temp.assert((players -> 0 ->> 'user_id')::uuid = brian, 'John gets his friend Brian''s id');
  perform pg_temp.assert((players -> 1 ->> 'user_id')::uuid = john, 'John gets his own id');
  perform pg_temp.assert((players -> 2 ->> 'user_id') is null, 'John does not get Sam''s id (a stranger to him)');
  perform pg_temp.assert((players -> 3 ->> 'user_id') is null, 'a guest has no id');

  -- John and Sam become friends: Sam's id is now returned.
  insert into friendships (requester, addressee, status) values (john, sam, 'accepted');
  players := pull_shared_rounds() -> 0 -> 'players';
  perform pg_temp.assert((players -> 2 ->> 'user_id')::uuid = sam, 'a new friend''s id is returned');

  -- A pending request does not count.
  delete from friendships where least(requester, addressee) = least(john, sam) and greatest(requester, addressee) = greatest(john, sam);
  insert into friendships (requester, addressee, status) values (john, sam, 'pending');
  perform pg_temp.assert((pull_shared_rounds() -> 0 -> 'players' -> 2 ->> 'user_id') is null, 'a pending request does not reveal an id');

  -- Blocking removes the friendship, so Brian's id stops being returned (the round stays in John's history).
  delete from friendships where least(requester, addressee) = least(john, brian) and greatest(requester, addressee) = greatest(john, brian);
  players := pull_shared_rounds() -> 0 -> 'players';
  perform pg_temp.assert((players -> 0 ->> 'user_id') is null and (players -> 1 ->> 'user_id')::uuid = john,
                         'after unfriending, the old friend''s id is gone and John''s own stays');

  -- A deleted account becomes a guest seat and has no id.
  insert into friendships (requester, addressee, status) values (john, brian, 'accepted');
  delete from auth.users where id = sam;
  players := pull_shared_rounds() -> 0 -> 'players';
  perform pg_temp.assert((players -> 2 ->> 'user_id') is null, 'a deleted account has no id');
end $$;

-- 2. list_live_rounds: the owner still gets every id; another player gets only their own and their friends'.
do $$
declare
  brian uuid := pg_temp.make_user('fid_brian2'); john uuid := pg_temp.make_user('fid_john2');
  sam uuid := pg_temp.make_user('fid_sam2'); lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); ps uuid := gen_random_uuid();
  seats jsonb; players jsonb;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted'), (brian, sam, 'accepted');
  seats := jsonb_build_array(
    jsonb_build_object('id', pb, 'user_id', brian, 'position', 0), jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
    jsonb_build_object('id', ps, 'user_id', sam, 'position', 2));
  perform pg_temp.as_user(brian);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', null),
    'players', seats, 'scores', '[]'::jsonb));

  players := list_live_rounds() -> 0 -> 'players';
  perform pg_temp.assert((players -> 0 ->> 'user_id')::uuid = brian and (players -> 1 ->> 'user_id')::uuid = john
                         and (players -> 2 ->> 'user_id')::uuid = sam, 'the owner still gets every id');

  perform pg_temp.as_user(john);
  players := list_live_rounds() -> 0 -> 'players';
  perform pg_temp.assert((players -> 0 ->> 'user_id')::uuid = brian, 'a player gets the owner''s id (a friend)');
  perform pg_temp.assert((players -> 1 ->> 'user_id')::uuid = john, 'a player gets their own id');
  perform pg_temp.assert((players -> 2 ->> 'user_id') is null, 'a player does not get a stranger''s id');
end $$;
