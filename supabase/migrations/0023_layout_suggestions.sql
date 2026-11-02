-- Players fix course pars together. When someone finishes a round whose holes or pars they edited on a course that is
-- not verified yet, the app suggests those pars to the course with suggest_layout(). One vote per player per layout
-- (a new suggestion replaces their old one). As soon as two different players have suggested identical pars, the
-- layout takes them and becomes verified, and the votes are cleared. An admin's suggestion applies immediately.
--
-- Rounds that were already played keep their own pars (0022), so promoting a layout never rewrites anyone's scores.
-- Nothing here is readable by clients: the table has no policies and the function is the only way in.

create table public.layout_suggestions (
  layout_id uuid not null references public.course_layouts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,   -- deleting an account removes its votes
  pars int[] not null,
  created_at timestamptz not null default now(),
  primary key (layout_id, user_id),
  constraint layout_suggestions_pars_valid check (
    array_length(pars, 1) between 1 and 36 and array_position(pars, null) is null
    and 2 <= all (pars) and 6 >= all (pars))
);
create index layout_suggestions_user_recent_idx on public.layout_suggestions (user_id, created_at);
alter table public.layout_suggestions enable row level security;
revoke all on public.layout_suggestions from public, anon, authenticated;

-- Returns 'ok' (vote recorded), 'verified' (the course now has these pars), 'already_verified' (nothing to do) or
-- 'not_found'. Raises for pars that are not 1 to 36 holes of par 2 to 6, and after 20 new suggestions in a day.
create or replace function public.suggest_layout(p_layout_id uuid, p_pars int[]) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int := coalesce(array_length(p_pars, 1), 0);
  lay course_layouts;
  agree int;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if n not between 1 and 36 then raise exception 'A course needs 1 to 36 holes'; end if;
  if exists (select 1 from unnest(p_pars) x where x is null or x not between 2 and 6) then
    raise exception 'Par must be between 2 and 6';
  end if;

  -- Locking the layout row makes two simultaneous suggestions count each other.
  select * into lay from course_layouts where id = p_layout_id for update;
  if not found then return 'not_found'; end if;
  if lay.verified then return 'already_verified'; end if;

  if not exists (select 1 from layout_suggestions where layout_id = p_layout_id and user_id = uid)
     and (select count(*) from layout_suggestions where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'Too many suggestions today. Try again tomorrow';
  end if;

  insert into layout_suggestions (layout_id, user_id, pars) values (p_layout_id, uid, p_pars)
  on conflict (layout_id, user_id) do update set pars = excluded.pars, created_at = now();

  select count(*) into agree from layout_suggestions where layout_id = p_layout_id and pars = p_pars;
  if agree >= 2 or is_admin() then
    delete from holes where layout_id = p_layout_id and number > n;
    insert into holes (layout_id, number, par)
      select p_layout_id, i, p_pars[i] from generate_series(1, n) i
      on conflict (layout_id, number) do update set par = excluded.par;
    update course_layouts set hole_count = n, verified = true where id = p_layout_id;   -- the trigger clears the votes
    return 'verified';
  end if;
  return 'ok';
end $$;
revoke all on function public.suggest_layout(uuid, int[]) from public, anon;
grant execute on function public.suggest_layout(uuid, int[]) to authenticated;

-- A layout that becomes verified (by agreement, or by an admin through resolve_course_report) needs no more votes.
create or replace function public._clear_layout_suggestions() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from layout_suggestions where layout_id = new.id;
  return null;
end $$;
revoke all on function public._clear_layout_suggestions() from public, anon, authenticated;

create trigger course_layouts_verified after update of verified on public.course_layouts
  for each row when (new.verified and not old.verified) execute function public._clear_layout_suggestions();
