-- Discores milestone 2b: review queue for course reports.
-- Admins live in their own table that clients cannot read or write. Grant access from the SQL editor:
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;   -- no policies: invisible to clients
revoke all on public.admins from anon, authenticated;

alter table public.course_corrections
  add column resolved_by uuid references auth.users (id) on delete set null,
  add column resolved_at timestamptz;
create index on public.course_corrections (resolved_by);
create index on public.course_corrections (status, created_at);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Pending reports, oldest first, with the course's first layout so the reviewer can see the current pars.
create or replace function public.list_course_reports()
returns table (
  id uuid, course_id uuid, course_name text, area text, kind text, note text, created_at timestamptz,
  layout_id uuid, hole_count int, pars int[]
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
    select r.id, c.id, c.name, c.area, r.kind, r.note, r.created_at, l.id, l.hole_count,
           (select array_agg(h.par order by h.number) from holes h where h.layout_id = l.id)
    from course_corrections r
    join courses c on c.id = r.course_id
    left join lateral (
      select cl.id, cl.hole_count from course_layouts cl where cl.course_id = c.id order by cl.created_at, cl.id limit 1
    ) l on true
    where r.status = 'pending'
    order by r.created_at
    limit 50;
end $$;
revoke all on function public.list_course_reports() from public, anon;
grant execute on function public.list_course_reports() to authenticated;

-- Close a report. 'applied' may carry edits to the course's first layout; 'rejected' changes nothing.
-- Editing pars marks that layout verified. Reports for a course that was deleted are gone with it (cascade).
create or replace function public.resolve_course_report(
  p_id uuid, p_status text, p_name text default null, p_area text default null, p_pars int[] default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rep course_corrections;
  nm text := nullif(trim(coalesce(p_name, '')), '');
  ar text := nullif(trim(coalesce(p_area, '')), '');
  lid uuid;
  n int := coalesce(array_length(p_pars, 1), 0);
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  if p_status not in ('applied', 'rejected') then raise exception 'status must be applied or rejected'; end if;

  select * into rep from course_corrections where id = p_id for update;
  if not found then raise exception 'report not found'; end if;
  if rep.status <> 'pending' then raise exception 'report was already resolved'; end if;

  if p_status = 'applied' then
    if nm is not null then
      if char_length(nm) not between 2 and 80 then raise exception 'Course name must be 2 to 80 characters'; end if;
      update courses set name = nm where id = rep.course_id;
    end if;
    if p_area is not null then
      if ar is not null and char_length(ar) > 80 then raise exception 'Area must be 80 characters or fewer'; end if;
      update courses set area = ar where id = rep.course_id;   -- empty string clears the area
    end if;
    if p_pars is not null then
      if n not between 1 and 36 then raise exception 'A course needs 1 to 36 holes'; end if;
      if exists (select 1 from unnest(p_pars) x where x is null or x not between 2 and 6) then
        raise exception 'Par must be between 2 and 6';
      end if;
      select cl.id into lid from course_layouts cl where cl.course_id = rep.course_id order by cl.created_at, cl.id limit 1;
      if lid is null then raise exception 'course has no layout'; end if;
      delete from holes where layout_id = lid and number > n;
      insert into holes (layout_id, number, par)
        select lid, i, p_pars[i] from generate_series(1, n) i
        on conflict (layout_id, number) do update set par = excluded.par;
      update course_layouts set hole_count = n, verified = true where id = lid;
    end if;
  end if;

  update course_corrections set status = p_status, resolved_by = uid, resolved_at = now() where id = p_id;
end $$;
revoke all on function public.resolve_course_report(uuid, text, text, text, int[]) from public, anon;
grant execute on function public.resolve_course_report(uuid, text, text, text, int[]) to authenticated;
