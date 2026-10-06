-- Blocking and reporting people.
-- Block: removes any friendship or request between you, and stops them from finding you by code, email or
-- username (their lookups look like "no match"). Rounds you already played together stay as they are.
-- Report: stored for an admin to review; an admin can also clear a reported username or reset a display name.

create table public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;   -- RPC-only

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter uuid references auth.users (id) on delete set null,
  reported uuid not null,                                 -- no FK: the report survives the account
  reason text not null check (reason in ('harassment', 'impersonation', 'inappropriate_name', 'spam', 'other')),
  note text not null default '' check (char_length(note) <= 500),
  status text not null default 'pending' check (status in ('pending', 'actioned', 'dismissed')),
  created_at timestamptz not null default now()
);
create unique index user_reports_one_pending on public.user_reports (reporter, reported) where status = 'pending';
alter table public.user_reports enable row level security;   -- RPC-only

-- Lookups: a blocked person sees "no match"; the blocker is told to unblock first.
create or replace function public._request_friend(uid uuid, target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f friendships;
begin
  if target = uid then return 'own_code'; end if;
  if exists (select 1 from blocks where blocker = uid and blocked = target) then return 'you_blocked'; end if;
  if exists (select 1 from blocks where blocker = target and blocked = uid) then return 'not_found'; end if;
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

create function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_user is null or p_user = uid then raise exception 'You cannot block yourself'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'That person no longer exists'; end if;
  insert into blocks (blocker, blocked) values (uid, p_user) on conflict do nothing;
  delete from friendships
  where least(requester, addressee) = least(uid, p_user) and greatest(requester, addressee) = greatest(uid, p_user);
end $$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from blocks where blocker = auth.uid() and blocked = p_user;
end $$;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.unblock_user(uuid) to authenticated;

create function public.list_blocked() returns table (user_id uuid, display_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  return query
    select b.blocked, p.display_name from blocks b join profiles p on p.id = b.blocked
    where b.blocker = auth.uid() order by b.created_at desc;
end $$;
revoke all on function public.list_blocked() from public, anon;
grant execute on function public.list_blocked() to authenticated;

-- You can report people you have (or had a request with) as a friend, and people you blocked.
-- Result: 'ok' | 'invalid' | 'not_allowed' | 'already_reported' | 'too_many'.
create function public.report_user(p_user uuid, p_reason text, p_note text default '') returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); n text := left(trim(coalesce(p_note, '')), 500);
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if p_user is null or p_user = uid
     or p_reason not in ('harassment', 'impersonation', 'inappropriate_name', 'spam', 'other') then
    return 'invalid';
  end if;
  if not (exists (select 1 from friendships
                  where least(requester, addressee) = least(uid, p_user) and greatest(requester, addressee) = greatest(uid, p_user))
          or exists (select 1 from blocks where blocker = uid and blocked = p_user)) then
    return 'not_allowed';
  end if;
  if (select count(*) from user_reports where reporter = uid and created_at > now() - interval '1 day') >= 10 then
    return 'too_many';
  end if;
  if exists (select 1 from user_reports where reporter = uid and reported = p_user and status = 'pending') then
    return 'already_reported';
  end if;
  insert into user_reports (reporter, reported, reason, note) values (uid, p_user, p_reason, n);
  return 'ok';
end $$;
revoke all on function public.report_user(uuid, text, text) from public, anon;
grant execute on function public.report_user(uuid, text, text) to authenticated;

-- Admin queue.
create function public.list_user_reports()
returns table (id uuid, reported uuid, display_name text, username text, reason text, note text,
               created_at timestamptz, other_pending int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
    select r.id, r.reported, coalesce(p.display_name, 'Deleted account'), p.username, r.reason, r.note, r.created_at,
           (select count(*)::int from user_reports o where o.reported = r.reported and o.status = 'pending' and o.id <> r.id)
    from user_reports r left join profiles p on p.id = r.reported
    where r.status = 'pending'
    order by r.created_at
    limit 50;
end $$;
revoke all on function public.list_user_reports() from public, anon;
grant execute on function public.list_user_reports() to authenticated;

-- 'actioned' may also clear the person's username (and hold it, and block username changes for 30 days) and/or
-- reset their display name. 'dismissed' changes nothing. Actioning closes every pending report about them.
create function public.resolve_user_report(
  p_id uuid, p_status text, p_clear_username boolean default false, p_reset_name boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare rep user_reports; cur text;
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('actioned', 'dismissed') then raise exception 'status must be actioned or dismissed'; end if;
  select * into rep from user_reports where id = p_id for update;
  if not found then raise exception 'report not found'; end if;
  if rep.status <> 'pending' then raise exception 'report was already resolved'; end if;
  if p_status = 'actioned' then
    if p_clear_username then
      perform set_config('discores.username_ok', '1', true);
      select username into cur from profiles where id = rep.reported;
      if cur is not null then
        insert into username_holds (username, released_by) values (cur, rep.reported)
          on conflict (username) do update set released_by = rep.reported, released_at = now();
        update profiles set username = null, username_changed_at = now() where id = rep.reported;
      end if;
    end if;
    if p_reset_name then update profiles set display_name = 'Player' where id = rep.reported; end if;
    update user_reports set status = 'actioned' where reported = rep.reported and status = 'pending';
  else
    update user_reports set status = 'dismissed' where id = p_id;
  end if;
end $$;
revoke all on function public.resolve_user_report(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.resolve_user_report(uuid, text, boolean, boolean) to authenticated;
