-- Discores milestone 2: course search, user-added courses, corrections, OpenStreetMap import.
-- Points are stored as point(longitude, latitude). location_approx is rounded to 2 decimals (~1 km).

create extension if not exists pg_trgm with schema extensions;

alter table public.courses add column osm_id text unique;   -- e.g. 'way/12345'; lets re-imports skip existing rows
create index courses_name_trgm on public.courses using gin (name extensions.gin_trgm_ops);
create index courses_area_trgm on public.courses using gin (area extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ search
-- One row per layout. security invoker: RLS and the column grants on courses still apply.
create or replace function public.search_courses(q text) returns table (
  layout_id uuid, course_id uuid, course_name text, area text, hole_count int, pars int[], source text
)
language sql stable security invoker set search_path = public as $$
  select l.id, c.id, c.name, c.area, l.hole_count,
         (select array_agg(h.par order by h.number) from holes h where h.layout_id = l.id),
         c.source
  from courses c
  join course_layouts l on l.course_id = c.id
  where char_length(trim(q)) >= 2
    and (c.name ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
      or c.area ilike '%' || replace(replace(replace(trim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by (c.name ilike trim(q) || '%') desc, c.name, l.name
  limit 25
$$;

revoke all on function public.search_courses(text) from public, anon;
grant execute on function public.search_courses(text) to authenticated;

-- -------------------------------------------------------------- add course
-- Users add a course with a name, a coarse area label and one par per hole. Exact coordinates are not collected.
create or replace function public.add_course(p_name text, p_area text, p_pars int[])
returns table (layout_id uuid, course_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  nm text := trim(coalesce(p_name, ''));
  ar text := nullif(trim(coalesce(p_area, '')), '');
  n int := coalesce(array_length(p_pars, 1), 0);
  cid uuid;
  lid uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if char_length(nm) not between 2 and 80 then raise exception 'Course name must be 2 to 80 characters'; end if;
  if ar is not null and char_length(ar) > 80 then raise exception 'Area must be 80 characters or fewer'; end if;
  if n not between 1 and 36 then raise exception 'A course needs 1 to 36 holes'; end if;
  if exists (select 1 from unnest(p_pars) x where x is null or x not between 2 and 6) then
    raise exception 'Par must be between 2 and 6';
  end if;
  if (select count(*) from courses where created_by = uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You have added too many courses today. Try again tomorrow';
  end if;
  if exists (select 1 from courses c where lower(c.name) = lower(nm) and lower(coalesce(c.area, '')) = lower(coalesce(ar, ''))) then
    raise exception 'A course with that name and area already exists. Search for it instead';
  end if;

  insert into courses (name, area, source, created_by) values (nm, ar, 'user', uid) returning id into cid;
  insert into course_layouts (course_id, hole_count) values (cid, n) returning id into lid;
  insert into holes (layout_id, number, par)
    select lid, i, p_pars[i] from generate_series(1, n) i;
  return query select lid, cid;
end $$;

revoke all on function public.add_course(text, text, int[]) from public, anon;
grant execute on function public.add_course(text, text, int[]) to authenticated;

-- ------------------------------------------------------------- corrections
-- Reports queue up for a human to review (service role / SQL editor). Nothing is applied automatically.
create table public.course_corrections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  submitted_by uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('name', 'holes', 'location', 'duplicate', 'other')),
  note text not null check (char_length(note) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  created_at timestamptz not null default now()
);
create index on public.course_corrections (course_id);
create index on public.course_corrections (submitted_by);
alter table public.course_corrections enable row level security;
create policy "corrections: submitter reads" on public.course_corrections
  for select to authenticated using (submitted_by = auth.uid());
-- No insert/update/delete policies: submit through report_course_issue().

create or replace function public.report_course_issue(p_course_id uuid, p_kind text, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if (select count(*) from course_corrections where submitted_by = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent too many reports today. Try again tomorrow';
  end if;
  insert into course_corrections (course_id, submitted_by, kind, note)
  values (p_course_id, uid, p_kind, trim(coalesce(p_note, '')));
end $$;

revoke all on function public.report_course_issue(uuid, text, text) from public, anon;
grant execute on function public.report_course_issue(uuid, text, text) to authenticated;

-- ------------------------------------------------------------- OSM import
-- items: [{osm_id, name, area, lat, lng, holes}]. Existing osm_ids are skipped, so re-running is safe.
-- OSM rarely knows par, so imported layouts get par 3 on every hole and stay unverified.
-- Callable only by the service role or from the SQL editor; clients cannot reach it.
create or replace function public.import_osm_courses(items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  cid uuid;
  lid uuid;
  n int;
  imported int := 0;
begin
  for it in select * from jsonb_array_elements(items) loop
    n := least(36, greatest(1, coalesce((it ->> 'holes')::int, 18)));
    insert into courses (osm_id, name, area, location_approx, exact_location, source)
    values (
      it ->> 'osm_id', left(it ->> 'name', 80), left(nullif(it ->> 'area', ''), 80),
      point(round((it ->> 'lng')::numeric, 2)::float8, round((it ->> 'lat')::numeric, 2)::float8),
      point((it ->> 'lng')::float8, (it ->> 'lat')::float8),
      'osm')
    on conflict (osm_id) do nothing
    returning id into cid;
    if cid is not null then
      insert into course_layouts (course_id, hole_count) values (cid, n) returning id into lid;
      insert into holes (layout_id, number, par) select lid, i, 3 from generate_series(1, n) i;
      imported := imported + 1;
    end if;
    cid := null;
  end loop;
  return imported;
end $$;

revoke all on function public.import_osm_courses(jsonb) from public, anon, authenticated;
grant execute on function public.import_osm_courses(jsonb) to service_role;
