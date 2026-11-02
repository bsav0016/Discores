-- similar_courses(), better matches. 0024 compared the raw names with a trigram score, which is diluted by the words
-- every course has ("Maple Hill" against "Maple Hill Disc Golf Course" scored 0.39, below the cut) and let in unrelated
-- ones that share only "Park" ("Jacobson Park" against "Lawcon Park" scored 0.30, on it). It now compares the "name
-- key" the importers already use (course_name_key: lower case, with "disc golf", "dgc", "course", "park" and "the"
-- removed), so:
--   * the same course with different filler words matches ("Maple Hill" and "Maple Hill DGC");
--   * a small spelling difference matches ("Jacobsen Park" and "Jacobson Park"; trigram similarity of the keys >= 0.5);
--   * a name typed so far matches the start of a longer one ("Jacobs" finds "Jacobson"), from 5 letters;
--   * a name that is only filler words (key shorter than 3 letters) matches nothing, instead of everything.
-- The area still ranks a course in the same place first.

create or replace function public.similar_courses(p_name text, p_area text default null) returns table (
  layout_id uuid, course_id uuid, course_name text, area text, hole_count int, pars int[], source text, verified boolean,
  similarity real
)
language sql stable security invoker set search_path = public, extensions as $$
  with q as (select course_name_key(p_name) as k)
  select l.id, c.id, c.name, c.area, l.hole_count,
         (select array_agg(h.par order by h.number) from holes h where h.layout_id = l.id),
         c.source, l.verified,
         (m.score
          + case when nullif(trim(coalesce(p_area, '')), '') is not null
                  and lower(coalesce(c.area, '')) like '%' || lower(trim(p_area)) || '%' then 0.15 else 0 end)::real
  from q
  join courses c on char_length(q.k) >= 3
  join course_layouts l on l.course_id = c.id
  cross join lateral (
    select case
      when course_name_key(c.name) = q.k then 1.0
      when char_length(q.k) >= 5 and course_name_key(c.name) like q.k || '%' then 0.8
      else similarity(course_name_key(c.name), q.k) end as score) m
  where m.score >= 0.5
  order by 9 desc, c.name, l.name
  limit 5
$$;
revoke all on function public.similar_courses(text, text) from public, anon;
grant execute on function public.similar_courses(text, text) to authenticated;
