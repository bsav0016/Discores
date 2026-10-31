-- Tests for migration 0021 (search_courses returns verified). Run by supabase/tests/run.sh.
\set ON_ERROR_STOP on

create or replace function pg_temp.assert(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
end $$;

begin;
insert into courses (id, name, area) values
  ('00000000-0000-0000-0000-0000000000a1', 'Zzz Verified Park', 'Testville, KY'),
  ('00000000-0000-0000-0000-0000000000a2', 'Zzz Placeholder Park', 'Testville, KY');
insert into course_layouts (id, course_id, hole_count, verified) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 2, true),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 2, false);
insert into holes (layout_id, number, par) values
  ('00000000-0000-0000-0000-0000000000b1', 1, 4), ('00000000-0000-0000-0000-0000000000b1', 2, 3),
  ('00000000-0000-0000-0000-0000000000b2', 1, 3), ('00000000-0000-0000-0000-0000000000b2', 2, 3);

-- Supabase gives signed-in users table access by default; plain Postgres does not, so grant it for this test.
grant select on course_layouts, holes to authenticated;

set local role authenticated;
select pg_temp.assert((select verified from search_courses('Zzz Verified')) is true, 'verified layout reports true');
select pg_temp.assert((select verified from search_courses('Zzz Placeholder')) is false, 'unverified layout reports false');
select pg_temp.assert((select count(*) from search_courses('Zzz')) = 2, 'both layouts found');
select pg_temp.assert((select pars from search_courses('Zzz Verified')) = '{4,3}', 'pars still returned in hole order');
reset role;

set local role anon;
select pg_temp.assert((select count(*) from search_courses('Zzz')) = 2, 'guests can still search');
reset role;
rollback;
