-- Optional usernames: an exact-match way to be found and added. No browsing, no prefix search.
-- Stored lowercase; 3-20 characters of a-z, 0-9 and underscore. Changeable once every 30 days, and a name a
-- person gives up stays reserved for 30 days so it can't be grabbed to impersonate them.
alter table public.profiles
  add column username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  add column username_changed_at timestamptz;

create table public.username_holds (
  username text primary key,
  released_by uuid not null references auth.users (id) on delete cascade,
  released_at timestamptz not null default now()
);
alter table public.username_holds enable row level security;   -- RPC-only

-- Clients may only change their username through set_username().
create or replace function public.profiles_protect_columns() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_pro is distinct from old.is_pro and auth.uid() is not null then
    raise exception 'is_pro cannot be changed by clients';
  end if;
  new.age_confirmed_at := old.age_confirmed_at;
  new.friend_code := old.friend_code;
  -- set_username() runs as the signed-in user too, so it vouches for itself with a transaction-local flag.
  if auth.uid() is not null and coalesce(current_setting('discores.username_ok', true), '') <> '1' then
    new.username := old.username;
    new.username_changed_at := old.username_changed_at;
  end if;
  return new;
end $$;

-- Result: 'ok' | 'cleared' | 'invalid' | 'taken' | 'unavailable' | 'too_soon' | 'unchanged'.
create function public.set_username(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  name text := lower(trim(coalesce(p_username, '')));
  cur record;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  perform set_config('discores.username_ok', '1', true);
  select username, username_changed_at into cur from profiles where id = uid;
  if name = '' then
    if cur.username is null then return 'unchanged'; end if;
    insert into username_holds (username, released_by) values (cur.username, uid)
      on conflict (username) do update set released_by = uid, released_at = now();
    update profiles set username = null, username_changed_at = now() where id = uid;
    return 'cleared';
  end if;
  name := ltrim(name, '@');
  if name !~ '^[a-z0-9_]{3,20}$' then return 'invalid'; end if;
  if name = cur.username then return 'unchanged'; end if;
  if name ~ '(admin|support|discores|official|moderator|staff)'
     or name ~ '(fuck|shit|cunt|nigg|nazi|hitler)' then
    return 'unavailable';
  end if;
  if cur.username_changed_at > now() - interval '30 days' then return 'too_soon'; end if;
  delete from username_holds where released_at < now() - interval '30 days';
  if exists (select 1 from username_holds where username = name and released_by <> uid) then return 'taken'; end if;
  if exists (select 1 from profiles where username = name) then return 'taken'; end if;
  if cur.username is not null then
    insert into username_holds (username, released_by) values (cur.username, uid)
      on conflict (username) do update set released_by = uid, released_at = now();
  end if;
  delete from username_holds where username = name and released_by = uid;
  update profiles set username = name, username_changed_at = now() where id = uid;
  return 'ok';
end $$;
revoke all on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- Same statuses as add_friend. A name nobody has and a name that doesn't exist look identical.
create function public.add_friend_by_username(p_username text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); target uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not _friend_attempt(uid) then return 'too_many'; end if;
  select id into target from profiles where username = ltrim(lower(trim(coalesce(p_username, ''))), '@');
  if target is null then return 'not_found'; end if;
  return _request_friend(uid, target);
end $$;
revoke all on function public.add_friend_by_username(text) from public, anon;
grant execute on function public.add_friend_by_username(text) to authenticated;
