-- Play with your group: friends' account ids in shared and live rounds.
--
-- The phone keeps every player's scores for rounds shared with you, but it could not tell WHICH friend a seat belonged
-- to (only a display name came back, and names repeat and change). To show a record against each friend, the app needs
-- the account id of the people it already knows. So:
--
-- * pull_shared_rounds() now returns 'user_id' on each player: your own, and an accepted friend's. Guests, strangers
--   (people in the round you are not friends with) and deleted accounts (their seat is a guest by then) have none.
-- * list_live_rounds() already returned every id to the round's owner; it now also returns your own id and your
--   friends' ids to the other players, and still omits everyone else's.
--
-- Blocking removes the friendship, so a blocked person's id stops being returned. Nothing new is exposed to anyone:
-- those players are already in the round with you and see each other's scores. The change is additive (old apps ignore
-- the field) and only replaces the two function bodies, so reverting means redeploying the bodies from 0022 and 0028.

create or replace function public.pull_shared_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'started_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name, 'hole_count', coalesce(array_length(r.pars, 1), l.hole_count),
        'pars', coalesce(to_jsonb(r.pars), to_jsonb((select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id))),
        'started_at', r.started_at, 'finished_at', r.finished_at,
        'players', (
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'position', p.position, 'is_me', coalesce(p.user_id = uid, false),
            'user_id', case when p.user_id = uid or are_friends(p.user_id, uid) then p.user_id end,
            'name', case when p.user_id is not null then pr.display_name
                         else coalesce(p.guest_name, 'Deleted player') end,
            'scores', (select coalesce(jsonb_agg(jsonb_build_object('hole_number', s.hole_number, 'strokes', s.strokes,
                                                                    'updated_at', s.updated_at)), '[]'::jsonb)
                       from scores s where s.round_player_id = p.id)) order by p.position)
          from round_players p left join profiles pr on pr.id = p.user_id
          where p.round_id = r.id)) as x
      from rounds r
      join course_layouts l on l.id = r.layout_id
      join courses c on c.id = l.course_id
      where r.finished_at is not null
        and r.created_by is distinct from uid
        and exists (select 1 from round_players me
                    where me.round_id = r.id and me.user_id = uid and me.confirmed_at is not null)
      order by r.started_at desc
      limit 200) t), '[]'::jsonb);
end $$;

create or replace function public.list_live_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'started_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name,
        'hole_count', coalesce(array_length(r.pars, 1), l.hole_count),
        'pars', coalesce(to_jsonb(r.pars), to_jsonb((select coalesce(array_agg(h.par order by h.number), '{}')
                                                     from holes h where h.layout_id = l.id))),
        'started_at', r.started_at, 'finished_at', r.finished_at,
        'is_owner', r.created_by = uid,
        'owner_name', coalesce(op.display_name, 'Someone'),
        'players', (
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'position', p.position, 'is_me', coalesce(p.user_id = uid, false),
            'user_id', case when r.created_by = uid or p.user_id = uid or are_friends(p.user_id, uid) then p.user_id end,
            'name', case when p.user_id is not null then pr.display_name
                         else coalesce(p.guest_name, 'Deleted player') end,
            'scores', (select coalesce(jsonb_agg(jsonb_build_object('hole_number', s.hole_number, 'strokes', s.strokes,
                                                                    'updated_at', s.updated_at)), '[]'::jsonb)
                       from scores s where s.round_player_id = p.id)) order by p.position)
          from round_players p left join profiles pr on pr.id = p.user_id
          where p.round_id = r.id and p.declined_at is null)) as x
      from rounds r
      join course_layouts l on l.id = r.layout_id
      join courses c on c.id = l.course_id
      left join profiles op on op.id = r.created_by
      where (r.finished_at is null or r.finished_at > now() - interval '1 hour')
        and r.started_at > now() - interval '3 days'
        and (r.created_by = uid
             or (r.created_by is not null and are_friends(r.created_by, uid)
                 and exists (select 1 from round_players me
                             where me.round_id = r.id and me.user_id = uid and me.declined_at is null)))
      order by r.started_at desc
      limit 20) t), '[]'::jsonb);
end $$;

revoke all on function public.pull_shared_rounds() from public, anon;
grant execute on function public.pull_shared_rounds() to authenticated;
revoke all on function public.list_live_rounds() from public, anon;
grant execute on function public.list_live_rounds() to authenticated;
