-- Development-only sample courses. Not real courses; replaced by the OSM import in milestone 2.
do $$
declare
  c1 uuid := gen_random_uuid();
  l1 uuid := gen_random_uuid();
  c2 uuid := gen_random_uuid();
  l2 uuid := gen_random_uuid();
begin
  insert into courses (id, name, area, source) values
    (c1, 'Sample Park (9 holes)', 'Sampleville', 'user'),
    (c2, 'Sample Woods (18 holes)', 'Sampleville', 'user');

  insert into course_layouts (id, course_id, name, hole_count) values
    (l1, c1, 'Default', 9), (l2, c2, 'Default', 18);

  insert into holes (layout_id, number, par)
  select l1, n, case when n % 3 = 0 then 4 else 3 end from generate_series(1, 9) n;
  insert into holes (layout_id, number, par)
  select l2, n, case when n % 3 = 0 then 4 when n % 7 = 0 then 5 else 3 end from generate_series(1, 18) n;
end $$;
