-- Overture Maps (places theme, CDLA Permissive 2.0) as a second source of courses, with de-duplication
-- against everything already loaded, so overlapping OSM / Overture / user entries do not pile up.

alter table public.courses add column overture_id text unique;
alter table public.courses drop constraint courses_source_check;
alter table public.courses add constraint courses_source_check
  check (source in ('osm', 'overture', 'user', 'verified'));

-- "Jacobson Park Disc Golf Course" and "Jacobson Park DGC" both become "jacobson".
create or replace function public.course_name_key(n text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    regexp_replace(lower(coalesce(n, '')), '(disc ?golf|disk golf|\mdgc\M|\mdgp\M|\mcourse\M|\mpark\M|\mthe\M)', '', 'g'),
    '[^a-z0-9]+', '', 'g')
$$;

-- items: [{overture_id, name, area, lat, lng, holes?}]. Skips an item when its overture_id is loaded, when any
-- course is within 400 m, or when a course with the same name key is within 5 km. Returns how many were added.
-- Imported layouts get par 3 on every hole and stay unverified. Service role / SQL editor only.
create or replace function public.import_overture_courses(items jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  cid uuid;
  lid uuid;
  lat float8;
  lng float8;
  nm text;
  n int;
  imported int := 0;
begin
  for it in select * from jsonb_array_elements(items) loop
    lat := (it ->> 'lat')::float8;
    lng := (it ->> 'lng')::float8;
    nm := left(trim(it ->> 'name'), 80);
    n := least(36, greatest(1, coalesce((it ->> 'holes')::int, 18)));
    continue when nm is null or char_length(nm) < 2;
    continue when exists (select 1 from courses where overture_id = it ->> 'overture_id');
    continue when exists (
      select 1 from courses c
      where c.exact_location is not null
        and (
          sqrt(power((c.exact_location[0] - lng) * 111320 * cos(radians(lat)), 2)
             + power((c.exact_location[1] - lat) * 110540, 2)) < 400
          or (course_name_key(c.name) = course_name_key(nm)
              and sqrt(power((c.exact_location[0] - lng) * 111320 * cos(radians(lat)), 2)
                     + power((c.exact_location[1] - lat) * 110540, 2)) < 5000)));

    insert into courses (overture_id, name, area, location_approx, exact_location, source)
    values (it ->> 'overture_id', nm, left(nullif(trim(it ->> 'area'), ''), 80),
            point(round(lng::numeric, 2)::float8, round(lat::numeric, 2)::float8), point(lng, lat), 'overture')
    returning id into cid;
    insert into course_layouts (course_id, hole_count) values (cid, n) returning id into lid;
    insert into holes (layout_id, number, par) select lid, i, 3 from generate_series(1, n) i;
    imported := imported + 1;
  end loop;
  return imported;
end $$;

revoke all on function public.import_overture_courses(jsonb) from public, anon, authenticated;
grant execute on function public.import_overture_courses(jsonb) to service_role;
