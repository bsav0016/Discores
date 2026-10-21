-- Tests for migration 0017 (delete_round and round tombstones). Run by supabase/tests/run.sh against a scratch
-- database that has every migration applied. Each block raises an exception on the first failed assertion and
-- rolls back its own data, so the blocks do not affect each other.
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

-- A one-hole course layout to play on.
create or replace function pg_temp.make_layout() returns uuid language plpgsql as $$
declare cid uuid := gen_random_uuid(); lid uuid := gen_random_uuid();
begin
  insert into courses (id, name) values (cid, 'Test Course ' || cid);
  insert into course_layouts (id, course_id, hole_count) values (lid, cid, 1);
  insert into holes (layout_id, number, par) values (lid, 1, 3);
  return lid;
end $$;

-- Pushes one round with the given finished_at (null = still in progress) from the signed-in user.
create or replace function pg_temp.push_with_finish(rid uuid, lid uuid, seat uuid, uid uuid, fin timestamptz) returns void
language plpgsql as $$
begin
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', fin),
    'players', jsonb_build_array(jsonb_build_object('id', seat, 'user_id', uid, 'position', 0)),
    'scores', '[]'::jsonb));
end $$;

-- Tests for migration 0019 (a finished round stays finished; the earliest finish time wins).
do $$
declare
  brian uuid := pg_temp.make_user('brian19'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); seat uuid := gen_random_uuid();
  t1 timestamptz := '2026-10-04 11:00:00+00'; t2 timestamptz := '2026-10-04 11:30:00+00';
begin
  perform pg_temp.as_user(brian);

  -- A stale device that still has the round in progress cannot un-finish it.
  perform pg_temp.push_with_finish(rid, lid, seat, brian, t2);
  perform pg_temp.push_with_finish(rid, lid, seat, brian, null);
  perform pg_temp.assert((select finished_at from rounds where id = rid) = t2, 'a null finish does not un-finish the round');

  -- Two devices finish the same round: the earlier time wins, whichever arrives first.
  perform pg_temp.push_with_finish(rid, lid, seat, brian, t1);
  perform pg_temp.assert((select finished_at from rounds where id = rid) = t1, 'an earlier finish replaces a later one');
  perform pg_temp.push_with_finish(rid, lid, seat, brian, t2);
  perform pg_temp.assert((select finished_at from rounds where id = rid) = t1, 'a later finish does not replace an earlier one');

  -- An unfinished round can still be finished.
  rid := gen_random_uuid(); seat := gen_random_uuid();
  perform pg_temp.push_with_finish(rid, lid, seat, brian, null);
  perform pg_temp.assert((select finished_at from rounds where id = rid) is null, 'starts unfinished');
  perform pg_temp.push_with_finish(rid, lid, seat, brian, t1);
  perform pg_temp.assert((select finished_at from rounds where id = rid) = t1, 'finishing sets the time');

  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;
