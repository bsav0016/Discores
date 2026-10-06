-- Guests (no account) can search courses. Course data is public and read-only; nothing else opens up.
create policy "courses readable by guests" on public.courses for select to anon using (true);
create policy "layouts readable by guests" on public.course_layouts for select to anon using (true);
create policy "holes readable by guests" on public.holes for select to anon using (true);
grant select on public.courses, public.course_layouts, public.holes to anon;
grant execute on function public.search_courses(text) to anon;
