-- Tests for migration 0018 (pull_my_rounds). Run by supabase/tests/run.sh after every migration is applied.
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

-- Brian owns a finished round with John (confirmed) and a guest, and an unfinished one. Brian gets both back with
-- seats and scores, and John (who owns neither) gets nothing. After Brian deletes the finished one, it is listed
-- as deleted and no longer returned as a round.
do $$
declare
  brian uuid := pg_temp.make_user('brian_pm'); john uuid := pg_temp.make_user('john_pm');
  lid uuid := pg_temp.make_layout(); r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); pg uuid := gen_random_uuid(); pb2 uuid := gen_random_uuid();
  got jsonb;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', r1, 'layout_id', lid, 'started_at', now(), 'finished_at', now()),
    'players', jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                                 jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
                                 jsonb_build_object('id', pg, 'guest_name', 'Janet', 'position', 2)),
    'scores', jsonb_build_array(jsonb_build_object('round_player_id', pb, 'hole_number', 1, 'strokes', 4, 'updated_at', now()),
                                jsonb_build_object('round_player_id', pj, 'hole_number', 1, 'strokes', 5, 'updated_at', now()))));
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', r2, 'layout_id', lid, 'started_at', now() - interval '1 day'),
    'players', jsonb_build_array(jsonb_build_object('id', pb2, 'user_id', brian, 'position', 0)),
    'scores', '[]'::jsonb));

  got := pull_my_rounds();
  perform pg_temp.assert(jsonb_array_length(got -> 'rounds') = 2, 'Brian gets both of his rounds');
  perform pg_temp.assert((got -> 'rounds' -> 0 ->> 'id')::uuid = r1, 'newest first');
  perform pg_temp.assert(got -> 'rounds' -> 1 -> 'finished_at' = 'null'::jsonb, 'the unfinished round comes back unfinished');
  perform pg_temp.assert(jsonb_array_length(got -> 'rounds' -> 0 -> 'players') = 3, 'all three seats');
  perform pg_temp.assert((got -> 'rounds' -> 0 -> 'pars' ->> 0)::int = 3 and (got -> 'rounds' -> 0 ->> 'hole_count')::int = 1,
                         'course data included');
  perform pg_temp.assert(
    (select p ->> 'guest_name' from jsonb_array_elements(got -> 'rounds' -> 0 -> 'players') p where (p ->> 'id')::uuid = pg) = 'Janet',
    'guest name kept');
  perform pg_temp.assert(
    (select p ->> 'name' from jsonb_array_elements(got -> 'rounds' -> 0 -> 'players') p where (p ->> 'id')::uuid = pj) = 'john_pm',
    'registered player name included');
  perform pg_temp.assert(
    (select (p -> 'scores' -> 0 ->> 'strokes')::int from jsonb_array_elements(got -> 'rounds' -> 0 -> 'players') p
      where (p ->> 'id')::uuid = pj) = 5, 'a friend''s score is included');
  perform pg_temp.assert(got -> 'deleted' = '[]'::jsonb, 'nothing deleted yet');

  perform pg_temp.as_user(john);
  perform pg_temp.assert(pull_my_rounds() = jsonb_build_object('rounds', '[]'::jsonb, 'deleted', '[]'::jsonb),
                         'John owns nothing, so gets nothing');

  perform pg_temp.as_user(brian);
  perform delete_round(r1);
  got := pull_my_rounds();
  perform pg_temp.assert(jsonb_array_length(got -> 'rounds') = 1 and (got -> 'rounds' -> 0 ->> 'id')::uuid = r2,
                         'the deleted round is no longer returned');
  perform pg_temp.assert(got -> 'deleted' = jsonb_build_array(r1), 'it is listed as deleted');

  -- Old tombstones are no longer reported.
  update round_tombstones set deleted_at = now() - interval '91 days' where round_id = r1;
  perform pg_temp.assert(pull_my_rounds() -> 'deleted' = '[]'::jsonb, 'tombstones older than 90 days are not reported');

  perform pg_temp.as_user(null);
  begin
    perform pull_my_rounds();
    raise exception 'FAILED: signed-out call should raise';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- Permissions: signed-out clients cannot call it.
do $$
begin
  perform pg_temp.assert(not has_function_privilege('anon', 'public.pull_my_rounds()', 'execute'), 'anon cannot execute');
  perform pg_temp.assert(has_function_privilege('authenticated', 'public.pull_my_rounds()', 'execute'), 'authenticated can');
end $$;
