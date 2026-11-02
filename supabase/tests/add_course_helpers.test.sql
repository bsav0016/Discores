-- Tests for migration 0024 (similar_courses and add_course recording the creator's pars as a suggestion).
\set ON_ERROR_STOP on

create or replace function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;

create or replace function pg_temp.make_user(name text) returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (uid, name || '@example.com',
          jsonb_build_object('display_name', name, 'birth_year', 1990, 'age_confirmed', 'true'));
  return uid;
end $$;

create or replace function pg_temp.assert(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if;
end $$;

-- Supabase gives signed-in users table access by default; plain Postgres does not.
grant select on courses, course_layouts, holes to authenticated;

insert into courses (id, name, area, source) values
  ('00000000-0000-0000-0000-0000000001a1', 'Jacobson Park Disc Golf Course', 'Lexington, KY', 'overture'),
  ('00000000-0000-0000-0000-0000000001a2', 'Jacobson Park DGC', 'Louisville, KY', 'overture'),
  ('00000000-0000-0000-0000-0000000001a3', 'Totally Different Place', 'Austin, TX', 'osm');
insert into course_layouts (id, course_id, hole_count, verified) values
  ('00000000-0000-0000-0000-0000000001b1', '00000000-0000-0000-0000-0000000001a1', 2, true),
  ('00000000-0000-0000-0000-0000000001b2', '00000000-0000-0000-0000-0000000001a2', 1, false),
  ('00000000-0000-0000-0000-0000000001b3', '00000000-0000-0000-0000-0000000001a3', 1, false);
insert into holes (layout_id, number, par) values
  ('00000000-0000-0000-0000-0000000001b1', 1, 4), ('00000000-0000-0000-0000-0000000001b1', 2, 3),
  ('00000000-0000-0000-0000-0000000001b2', 1, 3),
  ('00000000-0000-0000-0000-0000000001b3', 1, 3);

-- Similar names are found, the same place ranks first, different names and short input are not matched.
do $$
declare
  u uuid := pg_temp.make_user('similar_u'); got record; n int;
begin
  perform pg_temp.as_user(u);
  set local role authenticated;

  select count(*) into n from similar_courses('Jacobson Park', 'Lexington, KY');
  perform pg_temp.assert(n = 2, 'both Jacobson Park courses are found');
  select * into got from similar_courses('Jacobson Park', 'Lexington, KY') limit 1;
  perform pg_temp.assert(got.course_name = 'Jacobson Park Disc Golf Course', 'the one in Lexington ranks first');
  select * into got from similar_courses('Jacobson Park', 'Louisville') limit 1;
  perform pg_temp.assert(got.course_name = 'Jacobson Park DGC', 'and the one in Louisville first when that is the area');
  perform pg_temp.assert(got.verified is false and got.pars = '{3}', 'pars and the verified flag come back');

  select count(*) into n from similar_courses('jacobson dgc');
  perform pg_temp.assert(n >= 1, 'the name key (dgc, disc golf, park removed) also matches');
  select count(*) into n from similar_courses('Zzzzqqq Nothing');
  perform pg_temp.assert(n = 0, 'an unrelated name matches nothing');
  select count(*) into n from similar_courses('Ja');
  perform pg_temp.assert(n = 0, 'two letters are too short to match');
  select count(*) into n from similar_courses(null);
  perform pg_temp.assert(n = 0, 'null is fine');
  select count(*) into n from similar_courses('Park');
  perform pg_temp.assert(n <= 5, 'at most five');
  reset role;
end $$;

do $$
begin
  perform pg_temp.assert(not has_function_privilege('anon', 'public.similar_courses(text, text)', 'execute'), 'guests cannot call it');
  perform pg_temp.assert(has_function_privilege('authenticated', 'public.similar_courses(text, text)', 'execute'), 'signed-in can');
end $$;

-- A course a player adds carries their pars as their suggestion; a different player agreeing verifies it.
do $$
declare
  a uuid := pg_temp.make_user('add_a'); b uuid := pg_temp.make_user('add_b'); lid uuid; res text;
begin
  perform pg_temp.as_user(a);
  select layout_id into lid from add_course('Brand New Course', 'Boise, ID', array[3, 4, 5]);
  perform pg_temp.assert((select pars from layout_suggestions where layout_id = lid and user_id = a) = '{3,4,5}',
                         'the creator''s pars are recorded as their suggestion');
  perform pg_temp.assert(not (select verified from course_layouts where id = lid), 'a new course is unverified');

  perform pg_temp.as_user(b);
  res := suggest_layout(lid, '{3,4,5}');
  perform pg_temp.assert(res = 'verified', 'one other player agreeing with the creator verifies it');
  perform pg_temp.assert((select verified from course_layouts where id = lid), 'now verified');
end $$;

do $$
declare
  a uuid := pg_temp.make_user('add_c'); b uuid := pg_temp.make_user('add_d'); lid uuid; res text;
begin
  perform pg_temp.as_user(a);
  select layout_id into lid from add_course('Another New Course', 'Reno, NV', array[3, 3]);
  perform pg_temp.as_user(b);
  res := suggest_layout(lid, '{4,4}');
  perform pg_temp.assert(res = 'ok', 'a player who disagrees with the creator does not verify it');
  perform pg_temp.assert(not (select verified from course_layouts where id = lid), 'still unverified');

  -- the existing rules of add_course still hold
  perform pg_temp.as_user(a);
  begin
    perform add_course('Another New Course', 'Reno, NV', array[3, 3]);
    raise exception 'FAILED: an exact duplicate should be refused';
  exception when raise_exception then
    perform pg_temp.assert(sqlerrm like '%already exists%', 'exact duplicate refused: ' || sqlerrm);
  end;
end $$;

select 'add_course_helpers: all tests passed' as result;
