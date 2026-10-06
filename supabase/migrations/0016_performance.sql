-- From the Supabase performance advisor: indexes on foreign keys that lacked one, and row-level-security rules that
-- re-evaluated auth.uid() for every row. Wrapping it as (select auth.uid()) makes Postgres compute it once per
-- query. The rules mean exactly what they did before.

create index if not exists rounds_created_by_idx on public.rounds (created_by);
create index if not exists rounds_layout_id_idx on public.rounds (layout_id);
create index if not exists course_layouts_course_id_idx on public.course_layouts (course_id);
create index if not exists courses_created_by_idx on public.courses (created_by);
create index if not exists blocks_blocked_idx on public.blocks (blocked);
create index if not exists username_holds_released_by_idx on public.username_holds (released_by);

alter policy "profiles: owner can read" on public.profiles using ((select auth.uid()) = id);
alter policy "profiles: owner can update" on public.profiles
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
alter policy "rounds: creator reads" on public.rounds using (created_by = (select auth.uid()));
alter policy "players: creator reads" on public.round_players
  using (exists (select 1 from public.rounds r where r.id = round_players.round_id and r.created_by = (select auth.uid())));
alter policy "scores: creator reads" on public.scores
  using (exists (select 1 from public.round_players p join public.rounds r on r.id = p.round_id
                 where p.id = scores.round_player_id and r.created_by = (select auth.uid())));
alter policy "corrections: submitter reads" on public.course_corrections using (submitted_by = (select auth.uid()));
