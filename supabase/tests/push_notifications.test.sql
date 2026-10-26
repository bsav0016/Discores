-- Tests for migration 0020 (push tokens, notification settings and the outbox). Run by supabase/tests/run.sh against
-- a scratch database that has every migration applied. Each block raises an exception on the first failed
-- assertion; users are created with fresh ids so the blocks do not affect each other.
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

-- A unique, well-formed Expo token.
create or replace function pg_temp.tok() returns text language sql as $$
  select 'ExponentPushToken[' || replace(gen_random_uuid()::text, '-', '') || ']'
$$;

create or replace function pg_temp.befriend(a uuid, b uuid) returns void language plpgsql as $$
begin
  insert into friendships (requester, addressee, status) values (a, b, 'accepted');
end $$;

-- Syncs a round from `scorer` with the given registered players (the scorer is added automatically).
create or replace function pg_temp.seat(rid uuid, u uuid) returns uuid language sql as $$
  select coalesce((select id from round_players where round_id = rid and user_id = u), gen_random_uuid())
$$;

create or replace function pg_temp.sync(rid uuid, lid uuid, scorer uuid, fin timestamptz, others uuid[]) returns void
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
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', fin),
    'players', players, 'scores', '[]'::jsonb));
end $$;

create or replace function pg_temp.outbox_count(uid uuid, k text) returns int language sql as $$
  select count(*)::int from push_outbox where user_id = uid and kind = k
$$;

-- ----------------------------------------------------------------- tokens
do $$
declare
  a uuid := pg_temp.make_user('tok_a'); b uuid := pg_temp.make_user('tok_b');
  t text := pg_temp.tok(); n int;
begin
  perform pg_temp.as_user(a);
  perform pg_temp.assert(register_push_token(t, 'ios') = 'ok', 'a valid token registers');
  perform pg_temp.assert((select user_id from push_tokens where token = t) = a, 'the token belongs to the caller');
  perform pg_temp.assert(register_push_token(t, 'ios') = 'ok', 'registering again is fine');
  perform pg_temp.assert((select count(*) from push_tokens where token = t) = 1, 'no duplicate rows');

  perform pg_temp.assert(register_push_token('not-a-token', 'ios') = 'invalid', 'malformed token is refused');
  perform pg_temp.assert(register_push_token('', 'ios') = 'invalid', 'empty token is refused');
  perform pg_temp.assert(register_push_token(null, 'ios') = 'invalid', 'null token is refused');
  perform pg_temp.assert(register_push_token(pg_temp.tok(), 'windows') = 'invalid', 'unknown platform is refused');

  -- A shared phone follows the last person to sign in.
  perform pg_temp.as_user(b);
  perform pg_temp.assert(register_push_token(t, 'android') = 'ok', 'a second user can take over the phone');
  perform pg_temp.assert((select user_id from push_tokens where token = t) = b, 'the token moved to the new user');

  -- Signing out of the first account must not remove the second account's token.
  perform pg_temp.as_user(a);
  perform unregister_push_token(t);
  perform pg_temp.assert(exists (select 1 from push_tokens where token = t), 'unregister only removes your own token');
  perform pg_temp.as_user(b);
  perform unregister_push_token(t);
  perform pg_temp.assert(not exists (select 1 from push_tokens where token = t), 'unregister removes the token');

  -- At most 10 phones per account; the least recently seen go first.
  perform pg_temp.as_user(a);
  for n in 1..12 loop
    perform register_push_token(pg_temp.tok(), 'ios');
    update push_tokens set last_seen = now() - make_interval(secs => 100 - n) where user_id = a and last_seen > now() - interval '1 second';
  end loop;
  perform pg_temp.assert((select count(*) from push_tokens where user_id = a) = 10, 'ten phones at most');

  -- Signed-out callers are rejected.
  perform pg_temp.as_user(null);
  begin
    perform register_push_token(pg_temp.tok(), 'ios');
    raise exception 'FAILED: register without a session';
  exception when others then
    perform pg_temp.assert(sqlerrm = 'not authenticated', 'register needs a session');
  end;
end $$;

-- --------------------------------------------------------------- settings
do $$
declare a uuid := pg_temp.make_user('set_a');
begin
  perform pg_temp.as_user(a);
  perform pg_temp.assert(get_notification_settings() = '{"requests": true, "rounds": true}'::jsonb, 'both on by default');
  perform set_notification_settings(false, true);
  perform pg_temp.assert(get_notification_settings() = '{"requests": false, "rounds": true}'::jsonb, 'requests can be turned off');
  perform set_notification_settings(true, false);
  perform pg_temp.assert(get_notification_settings() = '{"requests": true, "rounds": false}'::jsonb, 'rounds can be turned off');
  begin
    perform set_notification_settings(null, true);
    raise exception 'FAILED: null setting accepted';
  exception when others then
    perform pg_temp.assert(sqlerrm = 'Both settings are required', 'null settings are refused');
  end;
end $$;

-- ----------------------------------------------------------- friend events
do $$
declare
  a uuid := pg_temp.make_user('fr_a'); b uuid := pg_temp.make_user('fr_b'); c uuid := pg_temp.make_user('fr_c');
  fid uuid;
begin
  -- B has a phone, A does not.
  perform pg_temp.as_user(b); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(a);
  insert into friendships (requester, addressee) values (a, b) returning id into fid;
  perform pg_temp.assert(pg_temp.outbox_count(b, 'friend_request') = 1, 'a friend request is queued for the addressee');
  perform pg_temp.assert((select actor_id from push_outbox where user_id = b) = a, 'the sender is recorded');
  perform pg_temp.assert((select ref_id from push_outbox where user_id = b) = fid, 'the friendship is referenced');
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_request') = 0, 'the requester is not told');

  -- A has no phone: accepting queues nothing for them.
  update friendships set status = 'accepted' where id = fid;
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_accepted') = 0, 'no phone, no message');

  -- A gets a phone; a second request that B accepts queues "accepted" for A.
  perform pg_temp.as_user(a); perform register_push_token(pg_temp.tok(), 'ios');
  insert into friendships (requester, addressee) values (a, c) returning id into fid;
  perform pg_temp.assert(pg_temp.outbox_count(c, 'friend_request') = 0, 'a person without a phone is not queued');
  perform pg_temp.as_user(c); perform register_push_token(pg_temp.tok(), 'ios');
  update friendships set status = 'accepted' where id = fid;
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_accepted') = 1, 'accepting tells the requester');

  -- Updating an accepted friendship again does not queue anything more.
  update friendships set status = 'accepted' where id = fid;
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_accepted') = 1, 'no repeat for an unchanged status');
end $$;

-- A request that turns into acceptance through add_friend (they had asked first) tells the first requester.
do $$
declare
  a uuid := pg_temp.make_user('mut_a'); b uuid := pg_temp.make_user('mut_b');
begin
  perform pg_temp.as_user(a); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(b); perform register_push_token(pg_temp.tok(), 'ios');
  perform add_friend((select friend_code from profiles where id = a));      -- B asks A
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_request') = 1, 'add_friend queues the request');
  perform pg_temp.as_user(a);
  perform add_friend((select friend_code from profiles where id = b));      -- A asks B back: accepted
  perform pg_temp.assert(pg_temp.outbox_count(b, 'friend_accepted') = 1, 'a mutual request tells the first requester');
end $$;

-- Settings, blocks and the hourly cap apply to friend requests.
do $$
declare
  a uuid := pg_temp.make_user('cap_a'); b uuid := pg_temp.make_user('cap_b'); c uuid := pg_temp.make_user('cap_c');
  d uuid := pg_temp.make_user('cap_d'); other uuid; i int;
begin
  perform pg_temp.as_user(b); perform register_push_token(pg_temp.tok(), 'ios');
  perform set_notification_settings(false, true);
  insert into friendships (requester, addressee) values (a, b);
  perform pg_temp.assert(pg_temp.outbox_count(b, 'friend_request') = 0, 'requests switched off: nothing queued');
  perform set_notification_settings(true, true);
  delete from friendships where requester = a;

  -- Blocked in either direction: nothing queued.
  insert into blocks (blocker, blocked) values (b, a);
  insert into friendships (requester, addressee) values (a, b);
  perform pg_temp.assert(pg_temp.outbox_count(b, 'friend_request') = 0, 'a blocked sender cannot notify');
  delete from friendships where requester = a;
  delete from blocks;
  insert into blocks (blocker, blocked) values (a, b);
  insert into friendships (requester, addressee) values (a, b);
  perform pg_temp.assert(pg_temp.outbox_count(b, 'friend_request') = 0, 'a sender who blocked the person cannot notify');
  delete from friendships where requester = a;
  delete from blocks;

  -- Ten messages an hour, however many people ask.
  for i in 1..14 loop
    other := pg_temp.make_user('cap_x' || i);
    insert into friendships (requester, addressee) values (other, c);
  end loop;
  perform pg_temp.as_user(c); perform register_push_token(pg_temp.tok(), 'ios');
  for i in 1..14 loop
    other := pg_temp.make_user('cap_y' || i);
    insert into friendships (requester, addressee) values (other, c);
  end loop;
  perform pg_temp.assert(pg_temp.outbox_count(c, 'friend_request') = 10, 'the hourly cap is 10');
  -- A message older than an hour no longer counts.
  update push_outbox set created_at = now() - interval '2 hours' where user_id = c;
  insert into friendships (requester, addressee) values (pg_temp.make_user('cap_z'), c);
  perform pg_temp.assert(pg_temp.outbox_count(c, 'friend_request') = 11, 'old messages leave the cap window');
end $$;

-- ------------------------------------------------------------- round events
do $$
declare
  scorer uuid := pg_temp.make_user('rd_scorer'); f1 uuid := pg_temp.make_user('rd_f1');
  f2 uuid := pg_temp.make_user('rd_f2'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); fin timestamptz := '2026-10-04 11:00:00+00';
begin
  perform pg_temp.befriend(scorer, f1); perform pg_temp.befriend(scorer, f2);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(f2); perform register_push_token(pg_temp.tok(), 'android');
  perform pg_temp.as_user(scorer); perform register_push_token(pg_temp.tok(), 'ios');

  -- While the round is in progress nobody is told.
  perform pg_temp.sync(rid, lid, scorer, null, array[f1, f2]);
  perform pg_temp.assert((select count(*) from push_outbox where kind = 'round_to_confirm' and ref_id = rid) = 0,
                         'an unfinished round queues nothing');

  -- Finishing it tells each friend, not the scorer.
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1, f2]);
  perform pg_temp.assert(pg_temp.outbox_count(f1, 'round_to_confirm') = 1, 'first friend is told');
  perform pg_temp.assert(pg_temp.outbox_count(f2, 'round_to_confirm') = 1, 'second friend is told');
  perform pg_temp.assert(pg_temp.outbox_count(scorer, 'round_to_confirm') = 0, 'the scorer is not told');
  perform pg_temp.assert((select actor_id from push_outbox where user_id = f1 and kind = 'round_to_confirm') = scorer, 'scorer is the actor');

  -- Syncing again, even from a stale device, queues nothing new.
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1, f2]);
  perform pg_temp.sync(rid, lid, scorer, null, array[f1, f2]);
  perform pg_temp.assert((select count(*) from push_outbox where kind = 'round_to_confirm' and ref_id = rid) = 2,
                         'each person is queued once per round');
end $$;

-- A round created already finished, a seat added later, guests, answered seats, settings, blocks.
do $$
declare
  scorer uuid := pg_temp.make_user('rs_scorer'); f1 uuid := pg_temp.make_user('rs_f1');
  f2 uuid := pg_temp.make_user('rs_f2'); f3 uuid := pg_temp.make_user('rs_f3'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); fin timestamptz := '2026-10-04 11:00:00+00';
begin
  perform pg_temp.befriend(scorer, f1); perform pg_temp.befriend(scorer, f2); perform pg_temp.befriend(scorer, f3);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(f2); perform register_push_token(pg_temp.tok(), 'ios'); perform set_notification_settings(true, false);
  perform pg_temp.as_user(f3); perform register_push_token(pg_temp.tok(), 'ios');
  insert into blocks (blocker, blocked) values (f3, scorer);

  -- Created finished with f1 only.
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1]);
  perform pg_temp.assert(pg_temp.outbox_count(f1, 'round_to_confirm') = 1, 'a round saved already finished queues');

  -- The scorer adds f2 (rounds switched off) and f3 (blocked the scorer) afterwards.
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1, f2, f3]);
  perform pg_temp.assert(pg_temp.outbox_count(f2, 'round_to_confirm') = 0, 'rounds switched off: nothing queued');
  perform pg_temp.assert(pg_temp.outbox_count(f3, 'round_to_confirm') = 0, 'a blocked scorer cannot notify');
  perform pg_temp.assert(pg_temp.outbox_count(f1, 'round_to_confirm') = 1, 'f1 is not queued twice');
end $$;

do $$
declare
  scorer uuid := pg_temp.make_user('rg_scorer'); f1 uuid := pg_temp.make_user('rg_f1'); lid uuid := pg_temp.make_layout();
  rid uuid := gen_random_uuid(); fin timestamptz := '2026-10-04 11:00:00+00';
begin
  perform pg_temp.befriend(scorer, f1);
  perform pg_temp.as_user(f1); perform register_push_token(pg_temp.tok(), 'ios');

  -- A guest seat and a stranger (not a friend, so stored as a guest) never queue anything.
  perform pg_temp.as_user(scorer);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now(), 'finished_at', fin),
    'players', jsonb_build_array(
      jsonb_build_object('id', gen_random_uuid(), 'user_id', scorer, 'position', 0),
      jsonb_build_object('id', gen_random_uuid(), 'guest_name', 'Pat', 'position', 1),
      jsonb_build_object('id', gen_random_uuid(), 'user_id', pg_temp.make_user('rg_stranger'), 'position', 2)),
    'scores', '[]'::jsonb));
  perform pg_temp.assert((select count(*) from push_outbox where ref_id = rid) = 0, 'guests and strangers queue nothing');

  -- A seat already answered is not announced when the round is saved again.
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1]);
  perform pg_temp.assert(pg_temp.outbox_count(f1, 'round_to_confirm') = 1, 'the friend is told');
  delete from push_outbox where ref_id = rid;
  perform pg_temp.as_user(f1);
  perform respond_round_confirmation(rid, true);
  perform pg_temp.sync(rid, lid, scorer, fin, array[f1]);
  perform pg_temp.assert((select count(*) from push_outbox where ref_id = rid) = 0, 'a confirmed seat is not announced again');
end $$;

-- ------------------------------------------------------- cleanup and delete
do $$
declare
  a uuid := pg_temp.make_user('del_a'); b uuid := pg_temp.make_user('del_b'); fid uuid;
begin
  perform pg_temp.as_user(a); perform register_push_token(pg_temp.tok(), 'ios');
  perform pg_temp.as_user(b);
  insert into friendships (requester, addressee) values (b, a) returning id into fid;
  perform pg_temp.assert(pg_temp.outbox_count(a, 'friend_request') = 1, 'queued before deletion');

  -- The person who sent it deletes their account: the message stays but loses the actor.
  perform delete_account();
  perform pg_temp.assert((select actor_id from push_outbox where user_id = a) is null, 'the deleted sender is cleared');

  -- The recipient deletes their account: tokens and queued messages go with it.
  perform pg_temp.as_user(a);
  perform delete_account();
  perform pg_temp.assert(not exists (select 1 from push_tokens where user_id = a), 'delete_account removes tokens');
  perform pg_temp.assert(not exists (select 1 from push_outbox where user_id = a), 'delete_account removes queued messages');
end $$;

-- Rows older than 30 days are pruned the next time anything is queued.
do $$
declare a uuid := pg_temp.make_user('old_a'); b uuid := pg_temp.make_user('old_b');
begin
  perform pg_temp.as_user(b); perform register_push_token(pg_temp.tok(), 'ios');
  insert into friendships (requester, addressee) values (a, b);
  update push_outbox set created_at = now() - interval '31 days' where user_id = b;
  insert into friendships (requester, addressee) values (pg_temp.make_user('old_c'), b);
  perform pg_temp.assert((select count(*) from push_outbox where user_id = b) = 1, 'old rows are pruned');
end $$;

-- Clients cannot read or change the tables directly.
do $$
declare a uuid := pg_temp.make_user('priv_a');
begin
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.push_tokens', 'select'), 'tokens are closed to clients');
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.push_outbox', 'select'), 'outbox is closed to clients');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.push_outbox', 'insert'), 'anon cannot write the outbox');
  perform pg_temp.assert(not has_function_privilege('authenticated', 'public._enqueue_push(text, uuid, uuid, uuid)', 'execute'),
                         'clients cannot queue messages');
  perform pg_temp.assert(not has_function_privilege('anon', 'public.register_push_token(text, text)', 'execute'),
                         'anon cannot register tokens');
end $$;

select 'push_notifications: all tests passed' as result;
