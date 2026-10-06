-- Discores milestone 3: friends (by code), registered players in rounds, shared finished rounds,
-- and account deletion that anonymizes you in rounds other people share.
--
-- Privacy shape: nobody can be searched for by name or email. You add a friend with their friend code, they
-- accept, and only then can you add them to a round. People who share a finished round see each other's display
-- names and nothing else. Everything goes through security definer RPCs; the tables stay closed to clients.

-- --------------------------------------------------------------- friend codes
-- 8 characters from a 31-letter alphabet without I, L, O, 0 or 1. Random bytes come from gen_random_uuid().
create or replace function public.gen_friend_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, 1 + (get_byte(bytes, i) % length(alphabet)), 1);
  end loop;
  return code;
end $$;
revoke all on function public.gen_friend_code() from public, anon, authenticated;

alter table public.profiles add column friend_code text unique default public.gen_friend_code();
update public.profiles set friend_code = public.gen_friend_code() where friend_code is null;
alter table public.profiles alter column friend_code set not null;

-- Clients may not change their friend code, and keep the earlier protections.
create or replace function public.profiles_protect_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_pro is distinct from old.is_pro and auth.uid() is not null then
    raise exception 'is_pro cannot be changed by clients';
  end if;
  new.age_confirmed_at := old.age_confirmed_at;
  new.friend_code := old.friend_code;
  return new;
end $$;

-- ------------------------------------------------------------------ friendships
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester <> addressee)
);
-- One row per pair, whichever side asked first.
create unique index friendships_pair on public.friendships (least(requester, addressee), greatest(requester, addressee));
create index on public.friendships (requester);
create index on public.friendships (addressee);
alter table public.friendships enable row level security;   -- no policies: RPC only

-- Slows down guessing friend codes.
create table public.friend_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index on public.friend_attempts (user_id, at);
alter table public.friend_attempts enable row level security;   -- no policies: RPC only

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from friendships
    where status = 'accepted'
      and least(requester, addressee) = least(a, b) and greatest(requester, addressee) = greatest(a, b))
$$;
revoke all on function public.are_friends(uuid, uuid) from public, anon, authenticated;

create or replace function public.my_friend_code() returns text
language sql stable security definer set search_path = public as $$
  select friend_code from profiles where id = auth.uid()
$$;
revoke all on function public.my_friend_code() from public, anon;
grant execute on function public.my_friend_code() to authenticated;

-- Returns 'requested' or 'accepted' (when they had already asked you).
create or replace function public.add_friend(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  target uuid;
  f friendships;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  delete from friend_attempts where user_id = uid and at < now() - interval '1 day';
  if (select count(*) from friend_attempts where user_id = uid and at > now() - interval '1 hour') >= 20 then
    raise exception 'Too many attempts. Try again in a while';
  end if;
  insert into friend_attempts (user_id) values (uid);

  select id into target from profiles where friend_code = upper(trim(coalesce(p_code, '')));
  if target is null then raise exception 'No one has that code'; end if;
  if target = uid then raise exception 'That is your own code'; end if;

  select * into f from friendships
  where least(requester, addressee) = least(uid, target) and greatest(requester, addressee) = greatest(uid, target);
  if found then
    if f.status = 'accepted' then raise exception 'You are already friends'; end if;
    if f.requester = uid then raise exception 'You already sent a request'; end if;
    update friendships set status = 'accepted' where id = f.id;     -- they had asked you first
    return 'accepted';
  end if;
  insert into friendships (requester, addressee) values (uid, target);
  return 'requested';
end $$;
revoke all on function public.add_friend(text) from public, anon;
grant execute on function public.add_friend(text) to authenticated;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_accept then
    update friendships set status = 'accepted' where id = p_id and addressee = uid and status = 'pending';
  else
    delete from friendships where id = p_id and addressee = uid and status = 'pending';
  end if;
  if not found then raise exception 'That request is no longer there'; end if;
end $$;
revoke all on function public.respond_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Unfriend, or cancel a request you sent. Rounds you already shared stay as they are.
create or replace function public.remove_friend(p_friendship_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from friendships where id = p_friendship_id and (requester = auth.uid() or addressee = auth.uid());
end $$;
revoke all on function public.remove_friend(uuid) from public, anon;
grant execute on function public.remove_friend(uuid) to authenticated;

-- kind: 'friend' | 'incoming' (they asked you) | 'outgoing' (you asked them)
create or replace function public.list_friends()
returns table (friendship_id uuid, user_id uuid, display_name text, kind text)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return query
    select f.id,
           case when f.requester = uid then f.addressee else f.requester end,
           p.display_name,
           case when f.status = 'accepted' then 'friend' when f.requester = uid then 'outgoing' else 'incoming' end
    from friendships f
    join profiles p on p.id = case when f.requester = uid then f.addressee else f.requester end
    where f.requester = uid or f.addressee = uid
    order by f.status desc, p.display_name;
end $$;
revoke all on function public.list_friends() from public, anon;
grant execute on function public.list_friends() to authenticated;

-- ------------------------------------------------------------ rounds with friends
-- A round can outlive its creator's account (see delete_account), so created_by may become null.
alter table public.rounds alter column created_by drop not null;
-- A person appears at most once per round.
create unique index round_players_round_user on public.round_players (round_id, user_id) where user_id is not null;

-- payload players: {id, user_id, guest_name, name, position}. A registered player must be you or an accepted
-- friend; anyone else is stored as a guest named by the `name` hint, so a friendship removed while offline
-- never leaves a round stuck unsynced.
create or replace function public.sync_round(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := payload -> 'round';
  rid uuid := (r ->> 'id')::uuid;
  existing_owner uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if jsonb_array_length(coalesce(payload -> 'players', '[]'::jsonb)) > 8 then
    raise exception 'A round can have at most 8 players';
  end if;

  select created_by into existing_owner from rounds where id = rid;
  if found and existing_owner is distinct from uid then
    raise exception 'round belongs to another user';
  end if;

  insert into rounds (id, layout_id, created_by, started_at, finished_at, updated_at)
  values (rid, (r ->> 'layout_id')::uuid, uid, (r ->> 'started_at')::timestamptz,
          nullif(r ->> 'finished_at', '')::timestamptz, now())
  on conflict (id) do update
    set finished_at = excluded.finished_at, updated_at = now();

  insert into round_players (id, round_id, user_id, guest_name, position)
  select (p ->> 'id')::uuid, rid, eff.uid,
         case when eff.uid is not null then null
              else left(coalesce(nullif(p ->> 'guest_name', ''), nullif(p ->> 'name', ''), 'Player'), 40) end,
         coalesce((p ->> 'position')::int, 0)
  from jsonb_array_elements(coalesce(payload -> 'players', '[]'::jsonb)) p
  cross join lateral (
    select case
      when nullif(p ->> 'user_id', '') is null then null
      when (p ->> 'user_id')::uuid = uid then uid
      when are_friends(uid, (p ->> 'user_id')::uuid) then (p ->> 'user_id')::uuid
      else null end as uid) eff
  on conflict (id) do update
    set guest_name = case when round_players.user_id is not null then null else excluded.guest_name end,
        position = excluded.position;

  insert into scores (round_player_id, hole_number, strokes, updated_at)
  select (s ->> 'round_player_id')::uuid, (s ->> 'hole_number')::int,
         (s ->> 'strokes')::int, (s ->> 'updated_at')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'scores', '[]'::jsonb)) s
  where exists (select 1 from round_players rp where rp.id = (s ->> 'round_player_id')::uuid and rp.round_id = rid)
  on conflict (round_player_id, hole_number) do update
    set strokes = excluded.strokes, updated_at = excluded.updated_at
    where scores.updated_at < excluded.updated_at;
end $$;

-- ---------------------------------------------------------------- shared rounds
-- Finished rounds somebody else created in which you are a registered player. Only display names leave the
-- server for the other players, never ids, and your own seat is flagged is_me.
create or replace function public.pull_shared_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'started_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name, 'hole_count', l.hole_count,
        'pars', (select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id),
        'started_at', r.started_at, 'finished_at', r.finished_at,
        'players', (
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'position', p.position, 'is_me', coalesce(p.user_id = uid, false),
            'name', case when p.user_id is not null then pr.display_name
                         else coalesce(p.guest_name, 'Deleted player') end,
            'scores', (select coalesce(jsonb_agg(jsonb_build_object('hole_number', s.hole_number, 'strokes', s.strokes,
                                                                    'updated_at', s.updated_at)), '[]'::jsonb)
                       from scores s where s.round_player_id = p.id)) order by p.position)
          from round_players p left join profiles pr on pr.id = p.user_id
          where p.round_id = r.id)) as x
      from rounds r
      join course_layouts l on l.id = r.layout_id
      join courses c on c.id = l.course_id
      where r.finished_at is not null
        and r.created_by is distinct from uid
        and exists (select 1 from round_players me where me.round_id = r.id and me.user_id = uid)
      order by r.started_at desc
      limit 200) t), '[]'::jsonb);
end $$;
revoke all on function public.pull_shared_rounds() from public, anon;
grant execute on function public.pull_shared_rounds() to authenticated;

-- ------------------------------------------------------------- account deletion
-- Finished rounds you created with other registered players stay for them (you become "Deleted player").
-- Everything else of yours goes, as before.
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update rounds r set created_by = null
  where r.created_by = uid and r.finished_at is not null
    and exists (select 1 from round_players p where p.round_id = r.id and p.user_id is not null and p.user_id <> uid);
  delete from auth.users where id = uid;   -- cascades to profile, friendships, remaining rounds; seats become null
end $$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
