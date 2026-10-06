-- add_friend raised an exception for a wrong code, and the exception rolled back the attempt row, so the
-- guessing limit never counted. Return a status instead of raising, so the attempt is kept.
-- Result: 'requested' | 'accepted' | 'not_found' | 'own_code' | 'already_friends' | 'already_sent' | 'too_many'.
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
    return 'too_many';
  end if;
  insert into friend_attempts (user_id) values (uid);

  select id into target from profiles where friend_code = upper(trim(coalesce(p_code, '')));
  if target is null then return 'not_found'; end if;
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
revoke all on function public.add_friend(text) from public, anon;
grant execute on function public.add_friend(text) to authenticated;
