-- A round carries its own holes and pars.
--
-- Until now a round's pars were always read from the course layout, so changing a layout (an admin fix, or the
-- player-agreed fixes that come next) silently rewrote the par of every round already played on it, and a player had
-- no way to say "hole 4 is a par 4" for their own round. The phone has always kept its own copy of the pars per
-- round; this makes the server do the same.
--
-- * rounds.pars (nullable int[]): the pars the round was played with; its length is the round's hole count.
-- * Existing rounds are filled from their layout once, here, so they stop following later layout changes.
-- * sync_round() accepts round.pars (1 to 36 holes, par 2 to 6). An app that sends none gets the layout's current
--   pars on the first sync, and later syncs from it leave the stored pars alone.
-- * pull_my_rounds, pull_shared_rounds and list_pending_rounds return the round's own pars and hole count, falling
--   back to the layout for any row without them. Their shape is unchanged, so installed apps keep working.

alter table public.rounds add column pars int[];
alter table public.rounds add constraint rounds_pars_valid
  check (pars is null or (array_length(pars, 1) between 1 and 36 and array_position(pars, null) is null
                          and 2 <= all (pars) and 6 >= all (pars)));

update public.rounds r
set pars = (select array_agg(h.par order by h.number) from public.holes h where h.layout_id = r.layout_id)
where r.pars is null;

create or replace function public.sync_round(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := payload -> 'round';
  rid uuid := (r ->> 'id')::uuid;
  existing_owner uuid;
  my_id uuid := auth.uid(); -- same as uid; a separate name because the lateral column below is also called uid
  own_pars int[];
begin
  if uid is null then raise exception 'not authenticated'; end if;
  -- The owner deleted this round (delete_round). A device that still has it must not bring it back.
  if exists (select 1 from round_tombstones where round_id = rid) then return; end if;
  if jsonb_array_length(coalesce(payload -> 'players', '[]'::jsonb)) > 8 then
    raise exception 'A round can have at most 8 players';
  end if;

  -- The holes and pars the player played this round with. Optional: an older app does not send them.
  if jsonb_typeof(r -> 'pars') = 'array' then
    select array_agg(x::int order by ord) into own_pars from jsonb_array_elements_text(r -> 'pars') with ordinality t(x, ord);
    if coalesce(array_length(own_pars, 1), 0) not between 1 and 36
       or exists (select 1 from unnest(own_pars) x where x is null or x not between 2 and 6) then
      raise exception 'A round needs 1 to 36 holes with par 2 to 6';
    end if;
  end if;

  select created_by into existing_owner from rounds where id = rid;
  if found and existing_owner is distinct from uid then
    raise exception 'round belongs to another user';
  end if;

  -- A round keeps its own pars from the moment it is first seen, so a later change to the course never rewrites
  -- an old round. When the app sent none, the layout's current pars are copied in once; later syncs from an app
  -- that sends none leave the stored pars alone.
  insert into rounds (id, layout_id, created_by, started_at, finished_at, updated_at, pars)
  values (rid, (r ->> 'layout_id')::uuid, uid, (r ->> 'started_at')::timestamptz,
          nullif(r ->> 'finished_at', '')::timestamptz, now(),
          coalesce(own_pars, (select array_agg(h.par order by h.number) from holes h
                              where h.layout_id = (r ->> 'layout_id')::uuid)))
  on conflict (id) do update
    set finished_at = least(rounds.finished_at, excluded.finished_at), updated_at = now(),
        pars = coalesce(own_pars, rounds.pars);

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

create or replace function public.pull_my_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return jsonb_build_object(
    'rounds', coalesce((
      select jsonb_agg(x order by x ->> 'started_at' desc) from (
        select jsonb_build_object(
          'id', r.id, 'layout_id', r.layout_id, 'course_name', c.name, 'hole_count', coalesce(array_length(r.pars, 1), l.hole_count),
          'pars', coalesce(to_jsonb(r.pars), to_jsonb((select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id))),
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

create or replace function public.list_pending_rounds() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  return coalesce((
    select jsonb_agg(x order by x ->> 'finished_at' desc) from (
      select jsonb_build_object(
        'round_id', r.id, 'course_name', c.name, 'hole_count', coalesce(array_length(r.pars, 1), l.hole_count),
        'pars', coalesce(to_jsonb(r.pars), to_jsonb((select coalesce(array_agg(h.par order by h.number), '{}') from holes h where h.layout_id = l.id))),
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
