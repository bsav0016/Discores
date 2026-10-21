-- Round-level conflict rule. Until now sync_round() overwrote finished_at with whatever the last device sent, so a
-- phone that still showed the round as in progress could un-finish a round another device had finished, and two
-- devices finishing the same round kept flip-flopping the time. A round that has been finished stays finished, and
-- the earliest finish time wins (least() ignores nulls, so it is only null while no device has finished the round).
-- Same as 0017 except for that one line. Scores keep their per-hole last-write-wins rule.

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
  -- The owner deleted this round (delete_round). A device that still has it must not bring it back.
  if exists (select 1 from round_tombstones where round_id = rid) then return; end if;
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
    set finished_at = least(rounds.finished_at, excluded.finished_at), updated_at = now();

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
