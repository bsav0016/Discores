-- Restoring your own rounds. Until now nothing read a player's own rounds back from the server, so a reinstall or a
-- second phone started empty. pull_my_rounds() returns every round you own (finished or not) with its seats and
-- scores, plus the ids of rounds you deleted (the tombstones from 0017), so another device can drop them.
-- Read-only: it changes nothing, so a restore never asks a friend to confirm a seat again.

create or replace function public.pull_my_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return jsonb_build_object(
    'rounds', coalesce((
      select jsonb_agg(x order by x ->> 'started_at' desc) from (
        select jsonb_build_object(
          'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name, 'hole_count', l.hole_count,
          'pars', (select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id),
          'started_at', r.started_at, 'finished_at', r.finished_at,
          'players', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'id', p.id, 'position', p.position, 'user_id', p.user_id,
              'guest_name', p.guest_name, 'name', pr.display_name,
              'scores', (select coalesce(jsonb_agg(jsonb_build_object('hole_number', s.hole_number, 'strokes', s.strokes,
                                                                      'updated_at', s.updated_at)), '[]'::jsonb)
                         from scores s where s.round_player_id = p.id)) order by p.position), '[]'::jsonb)
            from round_players p left join profiles pr on pr.id = p.user_id
            where p.round_id = r.id)) as x
        from rounds r
        join course_layouts l on l.id = r.layout_id
        join courses c on c.id = l.course_id
        where r.created_by = uid
        order by r.started_at desc
        limit 1000) t), '[]'::jsonb),
    'deleted', coalesce((select jsonb_agg(round_id) from round_tombstones
                         where owner_id = uid and deleted_at >= now() - interval '90 days'), '[]'::jsonb));
end $$;
revoke all on function public.pull_my_rounds() from public, anon;
grant execute on function public.pull_my_rounds() to authenticated;
