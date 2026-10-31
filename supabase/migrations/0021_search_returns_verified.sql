-- Course search also says whether a layout's holes and pars have been confirmed (course_layouts.verified), so the
-- app can tell players which pars are only a placeholder. The return type changes, so the function is recreated.
drop function if exists public.search_courses(text);

create function public.search_courses(q text) returns table (
  layout_id uuid, course_id uuid, course_name text, area text, hole_count int, pars int[], source text, verified boolean
)
language sql stable security invoker set search_path = public as $$
  select l.id, c.id, c.name, c.area, l.hole_count,
         (select array_agg(h.par order by h.number) from holes h where h.layout_id = l.id),
         c.source, l.verified
  from courses c
  join course_layouts l on l.course_id = c.id
  where char_length(trim(q)) >= 2
    and (c.name ilike '%' || replace(replace(replace(trim(q), '\', '\'), '%', '\%'), '_', '\_') || '%'
      or c.area ilike '%' || replace(replace(replace(trim(q), '\', '\'), '%', '\%'), '_', '\_') || '%')
  order by (c.name ilike trim(q) || '%') desc, c.name, l.name
  limit 25
$$;

revoke all on function public.search_courses(text) from public, anon;
grant execute on function public.search_courses(text) to authenticated, anon;
