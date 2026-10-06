-- A friend scored for you only counts once you confirm it. Until then the round is "pending": it is not in your
-- history or stats. Confirming keeps it (as before); declining unlinks the seat from your account, leaving just a
-- name (no link to you) on the scorer's round.
--   confirmed_at: the person accepted it (the scorer's own seat is confirmed when it is saved)
--   declined_at : the person said it was not theirs; the seat is then an unlinked, named seat

alter table public.round_players add column confirmed_at timestamptz, add column declined_at timestamptz;
-- Rounds that were already shared before this change stay in everyone's history.
update public.round_players set confirmed_at = now() where user_id is not null;

-- Same as before except: the scorer's seat is confirmed on insert, and an existing seat keeps its name when the
-- scorer's device re-sends it (a declined seat is no longer linked, so it must not turn into "Deleted player").
create or replace function public.sync_round(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := payload -> 'round';
  rid uuid := (r ->> 'id')::uuid;
  existing_owner uuid;
  my_id uuid := auth.uid(); -- same as uid; a separate name because the lateral column below is also called uid
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if jsonb_array_length(coalesce(payload -> 'players', '[]'::jsonb)) > 8 then
    raise exception 'A round can have at most 8 players';
  end if;

  select created_by into existing_owner from rounds where id = rid;
  if found and existing_owner is distinct from uid then
    raise exception 'round belongs to another user';
  end if;

  insert into rounds (id, layout_id, created_by, started_at, finished_at, updated_at)
  values (rid, (r ->> 'layout_id')::uuid, uid, (r ->> 'started_at')::timestamptz,
          nullif(r ->> 'finished_at', '')::timestamptz, now())
  on conflict (id) do update
    set finished_at = excluded.finished_at, updated_at = now();

  insert into round_players (id, round_id, user_id, guest_name, position, confirmed_at)
  select (p ->> 'id')::uuid, rid, eff.uid,
         case when eff.uid is not null then null
              else left(coalesce(nullif(p ->> 'guest_name', ''), nullif(p ->> 'name', ''), 'Player'), 40) end,
         coalesce((p ->> 'position')::int, 0),
         case when eff.uid = my_id then now() end
  from jsonb_array_elements(coalesce(payload -> 'players', '[]'::jsonb)) p
  cross join lateral (
    select case
      when nullif(p ->> 'user_id', '') is null then null
      when (p ->> 'user_id')::uuid = uid then uid
      when are_friends(uid, (p ->> 'user_id')::uuid) then (p ->> 'user_id')::uuid
      else null end as uid) eff
  on conflict (id) do update
    set guest_name = case when round_players.user_id is not null then null
                          else coalesce(excluded.guest_name, round_players.guest_name) end,
        position = excluded.position;

  insert into scores (round_player_id, hole_number, strokes, updated_at)
  select (s ->> 'round_player_id')::uuid, (s ->> 'hole_number')::int,
         (s ->> 'strokes')::int, (s ->> 'updated_at')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'scores', '[]'::jsonb)) s
  where exists (select 1 from round_players rp where rp.id = (s ->> 'round_player_id')::uuid and rp.round_id = rid)
  on conflict (round_player_id, hole_number) do update
    set strokes = excluded.strokes, updated_at = excluded.updated_at
    where scores.updated_at < excluded.updated_at;
end $$;

-- Rounds that appear in your history: only ones where your own seat is confirmed.
create or replace function public.pull_shared_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'started_at' desc) from (
      select jsonb_build_object(
        'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name, 'hole_count', l.hole_count,
        'pars', (select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id),
        'started_at', r.started_at, 'finished_at', r.finished_at,
        'players', (
          select jsonb_agg(jsonb_build_object(
            'id', p.id, 'position', p.position, 'is_me', coalesce(p.user_id = uid, false),
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

-- Finished rounds where a friend scored you and you have not answered yet. Shows only your own scores.
create or replace function public.list_pending_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'finished_at' desc) from (
      select jsonb_build_object(
        'round_id', r.id, 'course_name', c.name, 'hole_count', l.hole_count,
        'pars', (select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id),
        'started_at', r.started_at, 'finished_at', r.finished_at,
        'scorer', coalesce(sp.display_name, 'Someone'),
        'scores', (select coalesce(jsonb_agg(jsonb_build_object('hole_number', s.hole_number, 'strokes', s.strokes)
                                             order by s.hole_number), '[]'::jsonb)
                   from scores s where s.round_player_id = me.id)) as x
      from round_players me
      join rounds r on r.id = me.round_id
      join course_layouts l on l.id = r.layout_id
      join courses c on c.id = l.course_id
      left join profiles sp on sp.id = r.created_by
      where me.user_id = uid and me.confirmed_at is null and me.declined_at is null
        and r.finished_at is not null and r.created_by is distinct from uid
      order by r.finished_at desc
      limit 50) t), '[]'::jsonb);
end $$;

-- Returns 'ok' | 'not_found' | 'not_signed_in'. Accepting adds the round to your history and stats. Declining
-- unlinks your account from the seat and leaves your name (as plain text) on the scorer's round.
create or replace function public.respond_round_confirmation(p_round uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  seat_id uuid;
  nm text;
begin
  if uid is null then return 'not_signed_in'; end if;
  select rp.id into seat_id
  from round_players rp join rounds r on r.id = rp.round_id
  where rp.round_id = p_round and rp.user_id = uid and rp.confirmed_at is null and rp.declined_at is null
    and r.finished_at is not null and r.created_by is distinct from uid
  for update of rp;
  if seat_id is null then return 'not_found'; end if;
  if p_accept then
    update round_players set confirmed_at = now() where id = seat_id;
  else
    select display_name into nm from profiles where id = uid;
    update round_players set user_id = null, guest_name = left(coalesce(nm, 'Player'), 40), declined_at = now()
    where id = seat_id;
  end if;
  return 'ok';
end $$;

-- For the scorer: where each seat in a round they scored stands. 'guest' = not a registered player.
create or replace function public.round_seat_status(p_round uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('player_id', rp.id, 'status',
      case when rp.declined_at is not null then 'declined'
           when rp.user_id is null then 'guest'
           when rp.confirmed_at is not null then 'confirmed'
           else 'pending' end))
    from round_players rp join rounds r on r.id = rp.round_id
    where r.id = p_round and r.created_by = uid), '[]'::jsonb);
end $$;

revoke all on function public.list_pending_rounds() from public, anon;
revoke all on function public.respond_round_confirmation(uuid, boolean) from public, anon;
revoke all on function public.round_seat_status(uuid) from public, anon;
grant execute on function public.list_pending_rounds() to authenticated;
grant execute on function public.respond_round_confirmation(uuid, boolean) to authenticated;
grant execute on function public.round_seat_status(uuid) to authenticated;
