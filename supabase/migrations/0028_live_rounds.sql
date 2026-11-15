-- Score together: friends in a round enter their own scores, live.
--
-- Until now only the round's owner could write to it (sync_round), and a friend saw the round only once it was
-- finished and they confirmed it. This adds two functions so a registered friend with a seat in an unfinished round
-- can follow it and write their own seat:
--
-- * list_live_rounds(): the unfinished rounds you own or have a seat in (plus ones finished in the last hour, so the
--   last scores arrive), with every seat and score. Read-only.
-- * sync_my_seat(p_round, p_scores): writes scores to YOUR seat only, while the round is unfinished or within the
--   grace window after it finished. Per-hole last-write-wins, exactly as sync_round. Writing confirms the seat, so a
--   friend who played along never sees the end-of-round "confirm" step.
--
-- sync_round is unchanged and stays owner-only, so the one-phone flow and older apps keep working. A friend's seat
-- stays the owner's to score until the friend writes to it; the owner can always keep writing any seat, and the
-- newer score per hole wins. Access needs an accepted friendship with the owner, so blocking (which removes the
-- friendship) or a deleted round (tombstone, owner removed) cuts it off. Additive: no table changes.

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
            'user_id', case when r.created_by = uid then p.user_id end,
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
revoke all on function public.list_live_rounds() from public, anon;
grant execute on function public.list_live_rounds() to authenticated;

-- p_scores: [{hole_number, strokes, updated_at}, ...]. Returns 'ok' | 'not_found' | 'closed' | 'not_signed_in'.
-- 'not_found' covers every case where the caller has no business writing: no such round, not their seat, the owner
-- (who uses sync_round), no longer friends with the owner, or a deleted round. 'closed' is a round that finished
-- more than the grace window ago.
create or replace function public.sync_my_seat(p_round uuid, p_scores jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  owner_id uuid;
  fin timestamptz;
  holes_in_round int;
  seat_id uuid;
begin
  if uid is null then return 'not_signed_in'; end if;
  if jsonb_typeof(coalesce(p_scores, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'scores must be a list';
  end if;
  if jsonb_array_length(coalesce(p_scores, '[]'::jsonb)) > 36 then
    raise exception 'A round has at most 36 holes';
  end if;

  select r.created_by, r.finished_at, coalesce(array_length(r.pars, 1), l.hole_count)
  into owner_id, fin, holes_in_round
  from rounds r join course_layouts l on l.id = r.layout_id
  where r.id = p_round;
  if not found or owner_id is null or owner_id = uid or not are_friends(owner_id, uid) then return 'not_found'; end if;

  select id into seat_id from round_players
  where round_id = p_round and user_id = uid and declined_at is null
  for update;
  if seat_id is null then return 'not_found'; end if;

  if fin is not null and fin <= now() - interval '1 hour' then return 'closed'; end if;

  -- A device clock ahead of the server cannot win every later edit: a score is never dated in the future.
  insert into scores (round_player_id, hole_number, strokes, updated_at)
  select seat_id, (s ->> 'hole_number')::int, (s ->> 'strokes')::int,
         least(coalesce(nullif(s ->> 'updated_at', '')::timestamptz, now()), now())
  from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) s
  where (s ->> 'hole_number')::int between 1 and holes_in_round
  on conflict (round_player_id, hole_number) do update
    set strokes = excluded.strokes, updated_at = excluded.updated_at
    where scores.updated_at < excluded.updated_at;

  -- Entering your own scores is your confirmation.
  if jsonb_array_length(coalesce(p_scores, '[]'::jsonb)) > 0 then
    update round_players set confirmed_at = coalesce(confirmed_at, now()) where id = seat_id;
  end if;
  return 'ok';
end $$;
revoke all on function public.sync_my_seat(uuid, jsonb) from public, anon;
grant execute on function public.sync_my_seat(uuid, jsonb) to authenticated;
