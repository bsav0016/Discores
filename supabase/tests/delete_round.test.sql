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

-- Pushes a finished one-hole round from the signed-in user: seats = [(seat id, user id or null, guest name)].
create or replace function pg_temp.push_round(rid uuid, lid uuid, seats jsonb, strokes int) returns void
language plpgsql as $$
begin
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', now()),
    'players', seats,
    'scores', (select jsonb_agg(jsonb_build_object('round_player_id', s ->> 'id', 'hole_number', 1,
                                                   'strokes', strokes, 'updated_at', now()))
               from jsonb_array_elements(seats) s)));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- 1. Brian records a score for John (who confirms) and for a guest. Brian deletes the round: Brian's seat and
--    scores are gone for everyone, John keeps his own score, the guest stays, and the round survives for John.
do $$
declare
  brian uuid := pg_temp.make_user('brian1'); john uuid := pg_temp.make_user('john1');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid(); pg uuid := gen_random_uuid();
  shared jsonb;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, jsonb_build_array(
    jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
    jsonb_build_object('id', pj, 'user_id', john, 'position', 1),
    jsonb_build_object('id', pg, 'guest_name', 'Janet', 'position', 2)), 4);
  perform pg_temp.as_user(john);
  perform pg_temp.assert(respond_round_confirmation(rid, true) = 'ok', 'John confirms his seat');
  shared := pull_shared_rounds();
  perform pg_temp.assert(jsonb_array_length(shared -> 0 -> 'players') = 3, 'John sees all three seats before the delete');

  perform pg_temp.as_user(brian);
  perform pg_temp.assert(delete_round(rid) = 'ok', 'Brian deletes the round');

  perform pg_temp.assert((select created_by is null from rounds where id = rid), 'the round is kept, with no owner');
  perform pg_temp.assert(not exists (select 1 from round_players where id = pb), 'Brian''s seat is gone');
  perform pg_temp.assert(not exists (select 1 from scores where round_player_id = pb), 'Brian''s scores are gone');
  perform pg_temp.assert(exists (select 1 from round_tombstones where round_id = rid and owner_id = brian), 'tombstone recorded');
  perform pg_temp.assert(jsonb_array_length(pull_shared_rounds()) = 0, 'Brian no longer sees the round');

  perform pg_temp.as_user(john);
  shared := pull_shared_rounds();
  perform pg_temp.assert(jsonb_array_length(shared) = 1, 'John still has the round');
  perform pg_temp.assert(jsonb_array_length(shared -> 0 -> 'players') = 2, 'John sees himself and the guest only');
  perform pg_temp.assert(
    (select (p -> 'scores' -> 0 ->> 'strokes')::int from jsonb_array_elements(shared -> 0 -> 'players') p
      where (p ->> 'is_me')::boolean) = 4, 'John keeps his own score');
  perform pg_temp.assert(not exists (
    select 1 from jsonb_array_elements(shared -> 0 -> 'players') p where p ->> 'name' = 'brian1'), 'Brian is not shown');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 2. Deleting twice is fine, and a device that still has the round cannot bring it back.
do $$
declare
  brian uuid := pg_temp.make_user('brian2'); john uuid := pg_temp.make_user('john2');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  pb uuid := gen_random_uuid(); pj uuid := gen_random_uuid();
  seats jsonb;
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  seats := jsonb_build_array(jsonb_build_object('id', pb, 'user_id', brian, 'position', 0),
                             jsonb_build_object('id', pj, 'user_id', john, 'position', 1));
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, seats, 3);
  perform pg_temp.as_user(john);
  perform respond_round_confirmation(rid, true);
  perform pg_temp.as_user(brian);
  perform delete_round(rid);
  perform pg_temp.assert(delete_round(rid) = 'ok', 'deleting again is ok');

  perform pg_temp.push_round(rid, lid, seats, 9);   -- a stale device syncs the old round
  perform pg_temp.assert(not exists (select 1 from round_players where id = pb), 'Brian''s seat is not recreated');
  perform pg_temp.assert((select strokes from scores where round_player_id = pj) = 3, 'John''s score is not overwritten');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 3. Only the owner can delete. A friend who kept the round cannot delete it for everyone, and a stranger cannot
--    delete anything.
do $$
declare
  brian uuid := pg_temp.make_user('brian3'); john uuid := pg_temp.make_user('john3'); eve uuid := pg_temp.make_user('eve3');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'user_id', brian, 'position', 0),
    jsonb_build_object('id', gen_random_uuid(), 'user_id', john, 'position', 1)), 3);
  perform pg_temp.as_user(john);
  perform respond_round_confirmation(rid, true);

  perform pg_temp.assert(delete_round(rid) = 'not_found', 'a friend cannot delete the owner''s round');
  perform pg_temp.as_user(eve);
  perform pg_temp.assert(delete_round(rid) = 'not_found', 'a stranger cannot delete it');
  perform pg_temp.assert(exists (select 1 from rounds where id = rid), 'the round is untouched');
  perform pg_temp.assert(not exists (select 1 from round_tombstones where round_id = rid), 'no tombstone was written');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 4. A friend who has not answered yet loses the pending seat, and with nobody left to keep it the round is deleted.
do $$
declare
  brian uuid := pg_temp.make_user('brian4'); john uuid := pg_temp.make_user('john4');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
begin
  insert into friendships (requester, addressee, status) values (brian, john, 'accepted');
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'user_id', brian, 'position', 0),
    jsonb_build_object('id', gen_random_uuid(), 'user_id', john, 'position', 1)), 3);
  perform pg_temp.as_user(john);
  perform pg_temp.assert(jsonb_array_length(list_pending_rounds()) = 1, 'John has a pending round');

  perform pg_temp.as_user(brian);
  perform delete_round(rid);
  perform pg_temp.assert(not exists (select 1 from rounds where id = rid), 'the round is deleted');
  perform pg_temp.assert(not exists (select 1 from round_players rp where rp.round_id = rid), 'no seats are left');
  perform pg_temp.as_user(john);
  perform pg_temp.assert(jsonb_array_length(list_pending_rounds()) = 0, 'the pending round is gone for John');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 5. A round with only the owner and guests is deleted outright, and cannot be resurrected.
do $$
declare
  brian uuid := pg_temp.make_user('brian5');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  seats jsonb;
begin
  seats := jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'user_id', brian, 'position', 0),
                             jsonb_build_object('id', gen_random_uuid(), 'guest_name', 'Pat', 'position', 1));
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, seats, 3);
  perform pg_temp.assert(delete_round(rid) = 'ok', 'delete');
  perform pg_temp.assert(not exists (select 1 from rounds where id = rid), 'round is gone');
  perform pg_temp.push_round(rid, lid, seats, 3);
  perform pg_temp.assert(not exists (select 1 from rounds where id = rid), 'a late sync does not recreate it');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 6. Tombstones older than 90 days are removed the next time a round is deleted; newer ones stay.
do $$
declare
  brian uuid := pg_temp.make_user('brian6');
  lid uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid();
  old_id uuid := gen_random_uuid(); recent_id uuid := gen_random_uuid();
begin
  insert into round_tombstones (round_id, owner_id, deleted_at) values
    (old_id, brian, now() - interval '91 days'), (recent_id, brian, now() - interval '89 days');
  perform pg_temp.as_user(brian);
  perform pg_temp.push_round(rid, lid, jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid(), 'user_id', brian, 'position', 0)), 3);
  perform delete_round(rid);
  perform pg_temp.assert(not exists (select 1 from round_tombstones where round_id = old_id), 'the 91-day tombstone is purged');
  perform pg_temp.assert(exists (select 1 from round_tombstones where round_id = recent_id), 'the 89-day tombstone stays');
  perform pg_temp.assert(exists (select 1 from round_tombstones where round_id = rid), 'the new tombstone is recorded');
  raise exception 'rollback';
exception when others then
  if sqlerrm <> 'rollback' then raise; end if;
end $$;

-- 7. Signed-out callers are refused, and clients cannot read the tombstone table directly.
do $$
begin
  perform pg_temp.as_user(null);
  perform pg_temp.assert(delete_round(gen_random_uuid()) = 'not_signed_in', 'signed-out delete is refused');
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.round_tombstones', 'select'),
                         'authenticated cannot read tombstones');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.round_tombstones', 'select'), 'anon cannot read tombstones');
  perform pg_temp.assert(not has_function_privilege('anon', 'public.delete_round(uuid)', 'execute'), 'anon cannot call delete_round');
  perform pg_temp.assert(has_function_privilege('authenticated', 'public.delete_round(uuid)', 'execute'),
                         'authenticated can call delete_round');
end $$;

select 'delete_round: all tests passed' as result;
