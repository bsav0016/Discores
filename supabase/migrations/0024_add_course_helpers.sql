-- Adding a course, made easier.
--
-- * similar_courses(name, area): courses whose name is close to what the player is typing, so "Add a course" can ask
--   "is it one of these?" before creating a duplicate. Uses the trigram index on courses.name (0003). Like
--   search_courses it runs as the caller, so the same row access rules apply.
-- * add_course() also records the pars the player entered as their suggestion for the new course (see 0023), so
--   one other player agreeing with them verifies it. Nothing else about it changes.

create or replace function public.similar_courses(p_name text, p_area text default null) returns table (
  layout_id uuid, course_id uuid, course_name text, area text, hole_count int, pars int[], source text, verified boolean,
  similarity real
)
language sql stable security invoker set search_path = public, extensions as $$
  select l.id, c.id, c.name, c.area, l.hole_count,
         (select array_agg(h.par order by h.number) from holes h where h.layout_id = l.id),
         c.source, l.verified,
         -- a course in the same place is a likelier match than one with a similar name elsewhere
         (greatest(similarity(c.name, trim(p_name)), case when course_name_key(c.name) = course_name_key(p_name) then 1.0 else 0 end)
          + case when nullif(trim(coalesce(p_area, '')), '') is not null
                  and lower(coalesce(c.area, '')) like '%' || lower(trim(p_area)) || '%' then 0.15 else 0 end)::real
  from courses c
  join course_layouts l on l.course_id = c.id
  where char_length(trim(coalesce(p_name, ''))) >= 3
    and (c.name % trim(p_name) or course_name_key(c.name) = course_name_key(p_name))
  order by 9 desc, c.name, l.name
  limit 5
$$;
revoke all on function public.similar_courses(text, text) from public, anon;
grant execute on function public.similar_courses(text, text) to authenticated;

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
  -- The pars the player entered count as their suggestion for the course: when another player later sets identical
  -- pars for it (suggest_layout, 0023), the course is verified.
  insert into layout_suggestions (layout_id, user_id, pars) values (lid, uid, p_pars);
  return query select lid, cid;
end $$;
