-- Tests for migration 0023 (suggest_layout and the agreement rule). Run by supabase/tests/run.sh.
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

-- A three-hole layout of par 3 on every hole, unverified (like an imported course).
create or replace function pg_temp.make_layout() returns uuid language plpgsql as $$
declare cid uuid := gen_random_uuid(); lid uuid := gen_random_uuid();
begin
  insert into courses (id, name) values (cid, 'Test Course ' || cid);
  insert into course_layouts (id, course_id, hole_count) values (lid, cid, 3);
  insert into holes (layout_id, number, par) values (lid, 1, 3), (lid, 2, 3), (lid, 3, 3);
  return lid;
end $$;

create or replace function pg_temp.layout_pars(lid uuid) returns int[] language sql as $$
  select array_agg(par order by number) from holes where layout_id = lid
$$;

create or replace function pg_temp.fails(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;

-- One vote is not enough; a second player with identical pars verifies the course, and the votes are cleared.
do $$
declare
  a uuid := pg_temp.make_user('sug_a'); b uuid := pg_temp.make_user('sug_b');
  lid uuid := pg_temp.make_layout();
begin
  perform pg_temp.as_user(a);
  perform pg_temp.assert(suggest_layout(lid, '{4,3,5,3,4}') = 'ok', 'first vote is recorded');
  perform pg_temp.assert(pg_temp.layout_pars(lid) = '{3,3,3}', 'one vote changes nothing');
  perform pg_temp.assert(not (select verified from course_layouts where id = lid), 'still unverified');

  perform pg_temp.as_user(b);
  perform pg_temp.assert(suggest_layout(lid, '{4,3,5,3,4}') = 'verified', 'the second identical vote verifies');
  perform pg_temp.assert(pg_temp.layout_pars(lid) = '{4,3,5,3,4}', 'the layout takes the agreed pars');
  perform pg_temp.assert((select hole_count from course_layouts where id = lid) = 5, 'and the hole count');
  perform pg_temp.assert((select verified from course_layouts where id = lid), 'and is verified');
  perform pg_temp.assert(not exists (select 1 from layout_suggestions where layout_id = lid), 'votes are cleared');
  perform pg_temp.assert(suggest_layout(lid, '{2,2}') = 'already_verified', 'a verified layout takes no more suggestions');
  perform pg_temp.assert(not exists (select 1 from layout_suggestions where layout_id = lid), 'and stores nothing');
end $$;

-- Different pars do not agree; one player cannot vote twice; changing a vote moves it.
do $$
declare
  a uuid := pg_temp.make_user('sug_c'); b uuid := pg_temp.make_user('sug_d'); c uuid := pg_temp.make_user('sug_e');
  lid uuid := pg_temp.make_layout();
begin
  perform pg_temp.as_user(a);
  perform pg_temp.assert(suggest_layout(lid, '{4,4,4}') = 'ok', 'a votes 4,4,4');
  perform pg_temp.assert(suggest_layout(lid, '{4,4,4}') = 'ok', 'the same player again is still one vote');
  perform pg_temp.assert((select count(*) from layout_suggestions where layout_id = lid) = 1, 'one row for a');
  perform pg_temp.as_user(b);
  perform pg_temp.assert(suggest_layout(lid, '{4,4,5}') = 'ok', 'b disagrees: no promotion');
  perform pg_temp.assert(not (select verified from course_layouts where id = lid), 'different votes do not verify');
  perform pg_temp.as_user(c);
  perform pg_temp.assert(suggest_layout(lid, '{3,3,3}') = 'ok', 'c votes yet another way');
  perform pg_temp.as_user(a);
  perform pg_temp.assert(suggest_layout(lid, '{4,4,5}') = 'verified', 'a changes their vote to agree with b');
  perform pg_temp.assert(pg_temp.layout_pars(lid) = '{4,4,5}', 'the agreed pars win');
end $$;

-- Bad input and missing things.
do $$
declare u uuid := pg_temp.make_user('sug_f'); lid uuid := pg_temp.make_layout();
begin
  perform pg_temp.as_user(u);
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, '{}')), 'no holes refused');
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, '{3,1}')), 'par 1 refused');
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, '{3,7}')), 'par 7 refused');
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, '{3,null}')), 'a missing par refused');
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, (select array_agg(3) from generate_series(1, 37)))),
                         '37 holes refused');
  perform pg_temp.assert(suggest_layout(gen_random_uuid(), '{3,3}') = 'not_found', 'an unknown layout');
  perform pg_temp.assert(not exists (select 1 from layout_suggestions where user_id = u), 'nothing stored');
  perform pg_temp.as_user(null);
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', lid, '{3,3}')), 'signed-out refused');
end $$;

-- 20 new suggestions a day.
do $$
declare u uuid := pg_temp.make_user('sug_rate'); first_lid uuid; lid uuid; i int;
begin
  perform pg_temp.as_user(u);
  for i in 1..20 loop
    lid := pg_temp.make_layout();
    if i = 1 then first_lid := lid; end if;
    perform suggest_layout(lid, '{3,4,3}');
  end loop;
  perform pg_temp.assert(pg_temp.fails(format('select suggest_layout(%L, %L)', pg_temp.make_layout(), '{3,4,3}')),
                         'the 21st new suggestion in a day is refused');
  perform pg_temp.assert(suggest_layout(first_lid, '{3,4,4}') = 'ok', 'changing an existing vote is still allowed');
end $$;

-- An admin's suggestion applies at once.
do $$
declare
  adm uuid := pg_temp.make_user('sug_admin'); lid uuid := pg_temp.make_layout();
begin
  insert into admins (user_id) values (adm);
  perform pg_temp.as_user(adm);
  perform pg_temp.assert(suggest_layout(lid, '{5,5}') = 'verified', 'admin applies immediately');
  perform pg_temp.assert(pg_temp.layout_pars(lid) = '{5,5}' and (select hole_count from course_layouts where id = lid) = 2,
                         'pars and hole count applied, extra hole removed');
end $$;

-- Rounds already played keep their own pars; an admin verifying through the other route clears votes too;
-- deleting an account removes its votes; clients cannot read the table.
do $$
declare
  a uuid := pg_temp.make_user('sug_g'); b uuid := pg_temp.make_user('sug_h');
  lid uuid := pg_temp.make_layout(); lid2 uuid := pg_temp.make_layout(); rid uuid := gen_random_uuid(); seat uuid := gen_random_uuid();
begin
  perform pg_temp.as_user(a);
  perform sync_round(jsonb_build_object(
    'round', jsonb_build_object('id', rid, 'layout_id', lid, 'started_at', now()),
    'players', jsonb_build_array(jsonb_build_object('id', seat, 'user_id', a, 'position', 0)),
    'scores', '[]'::jsonb));
  perform suggest_layout(lid, '{6,6,6}');
  perform pg_temp.as_user(b);
  perform pg_temp.assert(suggest_layout(lid, '{6,6,6}') = 'verified', 'verified');
  perform pg_temp.assert((select pars from rounds where id = rid) = '{3,3,3}', 'the round played before keeps its own pars');

  perform suggest_layout(lid2, '{4,4,4}');
  perform pg_temp.assert(exists (select 1 from layout_suggestions where layout_id = lid2), 'a vote exists');
  update course_layouts set verified = true where id = lid2;          -- what resolve_course_report does
  perform pg_temp.assert(not exists (select 1 from layout_suggestions where layout_id = lid2), 'verifying by any route clears the votes');
end $$;

do $$
declare
  a uuid := pg_temp.make_user('sug_del'); lid uuid := pg_temp.make_layout();
begin
  perform pg_temp.as_user(a);
  perform suggest_layout(lid, '{4,4,4}');
  perform pg_temp.assert(exists (select 1 from layout_suggestions where user_id = a), 'vote stored');
  delete from auth.users where id = a;
  perform pg_temp.assert(not exists (select 1 from layout_suggestions where user_id = a), 'deleting the account removes the vote');
end $$;

do $$
declare a uuid := pg_temp.make_user('sug_perm');
begin
  perform pg_temp.assert(not has_function_privilege('anon', 'public.suggest_layout(uuid, int[])', 'execute'), 'anon cannot suggest');
  perform pg_temp.assert(has_function_privilege('authenticated', 'public.suggest_layout(uuid, int[])', 'execute'), 'signed-in can');
  perform pg_temp.assert(not has_table_privilege('authenticated', 'public.layout_suggestions', 'select'), 'votes are not readable');
  perform pg_temp.assert(not has_table_privilege('anon', 'public.layout_suggestions', 'select'), 'nor for guests');
end $$;

select 'layout_suggestions: all tests passed' as result;
