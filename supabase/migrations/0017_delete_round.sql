-- Deleting a round. Until now a delete only happened on the phone: the server copy stayed, and it would come back
-- on any restore. delete_round() removes the owner's side of a round for good:
--   * The owner's own seat and scores are removed, so the owner's scores are gone from everyone's view.
--   * A friend whose seat the owner recorded and who confirmed it keeps their own scores: the round stays for them
--     (like a round whose owner deleted their account, see 0008), without the owner's seat. Seats still waiting for
--     an answer are removed, since nobody had accepted them. If no one is left to keep it, the round is deleted.
--   * A tombstone remembers the delete for 90 days, so a second device or a late sync cannot recreate the round.
--     Older tombstones are removed the next time anyone deletes a round.

create table public.round_tombstones (
  round_id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  deleted_at timestamptz not null default now()
);
create index round_tombstones_owner_id_idx on public.round_tombstones (owner_id);
create index round_tombstones_deleted_at_idx on public.round_tombstones (deleted_at);

-- Only the functions below touch it.
alter table public.round_tombstones enable row level security;
revoke all on public.round_tombstones from public, anon, authenticated;

-- Returns 'ok' (also when it was already deleted), 'not_found' (not your round) or 'not_signed_in'.
create or replace function public.delete_round(p_round uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then return 'not_signed_in'; end if;

  delete from round_tombstones where deleted_at < now() - interval '90 days';

  select id into rid from rounds where id = p_round and created_by = uid for update;
  if rid is null then
    if exists (select 1 from round_tombstones where round_id = p_round and owner_id = uid) then return 'ok'; end if;
    return 'not_found';
  end if;

  insert into round_tombstones (round_id, owner_id) values (rid, uid) on conflict do nothing;

  -- The owner's seat (its scores go with it) and seats nobody has answered yet.
  delete from round_players
  where round_id = rid
    and (user_id = uid or (user_id is not null and confirmed_at is null and declined_at is null));

  if exists (select 1 from round_players where round_id = rid and user_id is not null) then
    update rounds set created_by = null where id = rid;   -- stays for the players who kept their scores
  else
    delete from rounds where id = rid;
  end if;
  return 'ok';
end $$;
revoke all on function public.delete_round(uuid) from public, anon;
grant execute on function public.delete_round(uuid) to authenticated;

-- Same as 0015 except for the tombstone check at the top.
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
