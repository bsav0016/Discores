-- Push notifications, server side. Nothing is sent from here: this migration only records which phones belong to
-- which account and which events somebody should be told about. A sender (the send-push Edge Function) reads the
-- outbox and delivers the messages.
--
-- Events (kind in push_outbox):
--   friend_request    somebody sent you a friend request                  (ref_id = the friendship)
--   friend_accepted  somebody accepted your friend request               (ref_id = the friendship)
--   round_to_confirm a friend finished a round with you in it and it waits for your answer (ref_id = the round)
--
-- An event is queued only when the person has at least one registered phone, has not switched that category off,
-- has not blocked (or been blocked by) the other person, and has not hit the hourly cap. A round is queued once per
-- person, however many times it syncs. Messages carry the other person's display name at send time, never scores.

-- ------------------------------------------------------------------ settings
alter table public.profiles
  add column notify_requests boolean not null default true,
  add column notify_rounds boolean not null default true;

-- ---------------------------------------------------------------- push tokens
create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index push_tokens_user_id_idx on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
revoke all on public.push_tokens from public, anon, authenticated;   -- only the functions below touch it

-- Returns 'ok' or 'invalid'. A phone belongs to whoever signed in last, so a token already registered to someone
-- else moves to the caller. At most 10 phones per account: the least recently seen go first.
create or replace function public.register_push_token(p_token text, p_platform text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t text := trim(coalesce(p_token, ''));
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if t !~ '^Expo(nent)?PushToken\[[^\]]{1,180}\]$' or p_platform not in ('ios', 'android') then return 'invalid'; end if;
  insert into push_tokens (token, user_id, platform) values (t, uid, p_platform)
  on conflict (token) do update set user_id = uid, platform = excluded.platform, last_seen = now();
  delete from push_tokens
  where user_id = uid and token in (
    select token from push_tokens where user_id = uid order by last_seen desc offset 10);
  return 'ok';
end $$;
revoke all on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- Call on sign-out. Only removes the caller's own token.
create or replace function public.unregister_push_token(p_token text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from push_tokens where token = trim(coalesce(p_token, '')) and user_id = auth.uid();
end $$;
revoke all on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

create or replace function public.get_notification_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return (select jsonb_build_object('requests', notify_requests, 'rounds', notify_rounds)
          from profiles where id = auth.uid());
end $$;
revoke all on function public.get_notification_settings() from public, anon;
grant execute on function public.get_notification_settings() to authenticated;

create or replace function public.set_notification_settings(p_requests boolean, p_rounds boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_requests is null or p_rounds is null then raise exception 'Both settings are required'; end if;
  update profiles set notify_requests = p_requests, notify_rounds = p_rounds where id = auth.uid();
end $$;
revoke all on function public.set_notification_settings(boolean, boolean) from public, anon;
grant execute on function public.set_notification_settings(boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------- outbox
create table public.push_outbox (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'round_to_confirm')),
  user_id uuid not null references auth.users (id) on delete cascade,        -- who is told
  actor_id uuid references auth.users (id) on delete set null,               -- who did it (name looked up when sending)
  ref_id uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- The same event is queued once per person.
create unique index push_outbox_once on public.push_outbox (kind, user_id, ref_id);
create index push_outbox_unsent_idx on public.push_outbox (id) where sent_at is null;
create index push_outbox_user_recent_idx on public.push_outbox (user_id, created_at);
create index push_outbox_created_at_idx on public.push_outbox (created_at);
alter table public.push_outbox enable row level security;
revoke all on public.push_outbox from public, anon, authenticated;

-- Queues one event if the person wants it. Older rows are dropped here (30 days), so the table stays small.
create or replace function public._enqueue_push(p_kind text, p_user uuid, p_actor uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  delete from push_outbox where created_at < now() - interval '30 days';
  if not exists (select 1 from push_tokens where user_id = p_user) then return; end if;
  if not exists (
    select 1 from profiles
    where id = p_user
      and case when p_kind = 'round_to_confirm' then notify_rounds else notify_requests end) then return; end if;
  if p_actor is not null and exists (
    select 1 from blocks
    where (blocker = p_user and blocked = p_actor) or (blocker = p_actor and blocked = p_user)) then return; end if;
  -- At most 10 messages an hour per person, whatever other people do to them.
  if (select count(*) from push_outbox where user_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    return;
  end if;
  insert into push_outbox (kind, user_id, actor_id, ref_id) values (p_kind, p_user, p_actor, p_ref)
  on conflict do nothing;
end $$;
revoke all on function public._enqueue_push(text, uuid, uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------- friend events
create or replace function public._push_on_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform _enqueue_push('friend_request', new.addressee, new.requester, new.id);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    -- Whoever accepted is the other side from the person who asked.
    perform _enqueue_push('friend_accepted', new.requester, new.addressee, new.id);
  end if;
  return null;
end $$;
revoke all on function public._push_on_friendship() from public, anon, authenticated;

create trigger friendships_push after insert or update of status on public.friendships
  for each row execute function public._push_on_friendship();

-- -------------------------------------------------------------- round events
-- Tells every registered player who has not answered yet, once the round is finished. The scorer's own seat is
-- confirmed on insert, and guests have no account, so neither is told.
create or replace function public._push_round_seats(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select rp.user_id, rd.created_by
    from rounds rd join round_players rp on rp.round_id = rd.id
    where rd.id = p_round and rd.finished_at is not null and rd.created_by is not null
      and rp.user_id is not null and rp.user_id <> rd.created_by
      and rp.confirmed_at is null and rp.declined_at is null
  loop
    perform _enqueue_push('round_to_confirm', r.user_id, r.created_by, p_round);
  end loop;
end $$;
revoke all on function public._push_round_seats(uuid) from public, anon, authenticated;

create or replace function public._push_on_round() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _push_round_seats(new.id);
  return null;
end $$;
revoke all on function public._push_on_round() from public, anon, authenticated;

create or replace function public._push_on_seat() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform _push_round_seats(new.round_id);
  return null;
end $$;
revoke all on function public._push_on_seat() from public, anon, authenticated;

-- A round becomes finished, or is created already finished.
create trigger rounds_push after insert or update of finished_at on public.rounds
  for each row when (new.finished_at is not null) execute function public._push_on_round();
-- A registered player is added to a round that is already finished.
create trigger round_players_push after insert on public.round_players
  for each row when (new.user_id is not null and new.confirmed_at is null) execute function public._push_on_seat();
