-- Opt-in "find me by email": people who switch it on can be sent a friend request by exact email address.
-- Off by default. There is no browsing and no name search; a lookup only ever answers "request sent" or
-- "no match", and a missing account and an account that isn't discoverable look identical.
alter table public.profiles add column discoverable boolean not null default false;

-- Shared by add_friend and add_friend_by_email: create the request, or accept one they already sent.
create function public._request_friend(uid uuid, target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f friendships;
begin
  if target = uid then return 'own_code'; end if;
  select * into f from friendships
  where least(requester, addressee) = least(uid, target) and greatest(requester, addressee) = greatest(uid, target);
  if found then
    if f.status = 'accepted' then return 'already_friends'; end if;
    if f.requester = uid then return 'already_sent'; end if;
    update friendships set status = 'accepted' where id = f.id;     -- they had asked you first
    return 'accepted';
  end if;
  insert into friendships (requester, addressee) values (uid, target);
  return 'requested';
end $$;
revoke all on function public._request_friend(uuid, uuid) from public, anon, authenticated;

-- Counts one attempt against the shared guessing limit; false when the limit is reached.
create function public._friend_attempt(uid uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from friend_attempts where user_id = uid and at < now() - interval '1 day';
  if (select count(*) from friend_attempts where user_id = uid and at > now() - interval '1 hour') >= 20 then
    return false;
  end if;
  insert into friend_attempts (user_id) values (uid);
  return true;
end $$;
revoke all on function public._friend_attempt(uuid) from public, anon, authenticated;

create or replace function public.add_friend(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); target uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not _friend_attempt(uid) then return 'too_many'; end if;
  select id into target from profiles where friend_code = upper(trim(coalesce(p_code, '')));
  if target is null then return 'not_found'; end if;
  return _request_friend(uid, target);
end $$;

-- Result: same statuses as add_friend.
create function public.add_friend_by_email(p_email text) returns text
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); target uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if not _friend_attempt(uid) then return 'too_many'; end if;
  select p.id into target
  from profiles p join auth.users u on u.id = p.id
  where p.discoverable and lower(u.email) = lower(trim(coalesce(p_email, '')));
  if target is null then return 'not_found'; end if;
  return _request_friend(uid, target);
end $$;
revoke all on function public.add_friend_by_email(text) from public, anon;
grant execute on function public.add_friend_by_email(text) to authenticated;
