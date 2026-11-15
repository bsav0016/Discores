-- Tell a friend when they are added to a round that is still being played.
--
-- New outbox event round_live: the owner's phone synced an unfinished round with a registered friend's seat in it
-- (ref_id = the round). The friend can then open it on their own phone (list_live_rounds, sync_my_seat). It uses the
-- same rules as every other event: queued once per person per round, only for a phone that registered, not when the
-- person switched the rounds category off, not across a block, and never past the hourly cap. A round that started
-- more than a day ago is not "live", so a late sync of an old unfinished round tells nobody. The message carries the
-- owner's display name and nothing else.
--
-- A friend who then plays along enters their own scores, which confirms their seat, so they are not asked to confirm
-- afterwards (round_to_confirm skips confirmed seats). One who never opens the round still gets round_to_confirm
-- when it finishes, exactly as before.

alter table public.push_outbox drop constraint push_outbox_kind_check;
alter table public.push_outbox add constraint push_outbox_kind_check
  check (kind in ('friend_request', 'friend_accepted', 'round_to_confirm', 'round_live'));

-- Same as 0020 except that round_live belongs to the same on/off switch as round_to_confirm.
create or replace function public._enqueue_push(p_kind text, p_user uuid, p_actor uuid, p_ref uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  delete from push_outbox where created_at < now() - interval '30 days';
  if not exists (select 1 from push_tokens where user_id = p_user) then return; end if;
  if not exists (
    select 1 from profiles
    where id = p_user
      and case when p_kind in ('round_to_confirm', 'round_live') then notify_rounds else notify_requests end) then return; end if;
  if p_actor is not null and exists (
    select 1 from blocks
    where (blocker = p_user and blocked = p_actor) or (blocker = p_actor and blocked = p_user)) then return; end if;
  -- At most 10 messages an hour per person, whatever other people do to them.
  if (select count(*) from push_outbox where user_id = p_user and created_at > now() - interval '1 hour') >= 10 then
    return;
  end if;
  insert into push_outbox (kind, user_id, actor_id, ref_id) values (p_kind, p_user, p_actor, p_ref)
  on conflict do nothing;
end $$;
revoke all on function public._enqueue_push(text, uuid, uuid, uuid) from public, anon, authenticated;

-- Finished round: tell every registered player who has not answered (as in 0020). Round in progress: tell every
-- registered friend who has a seat and has not entered scores yet that they can join.
create or replace function public._push_round_seats(p_round uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select rp.user_id, rd.created_by, rd.finished_at
    from rounds rd join round_players rp on rp.round_id = rd.id
    where rd.id = p_round and rd.created_by is not null
      and rp.user_id is not null and rp.user_id <> rd.created_by
      and rp.confirmed_at is null and rp.declined_at is null
      and (rd.finished_at is not null or (rd.started_at > now() - interval '1 day' and are_friends(rd.created_by, rp.user_id)))
  loop
    perform _enqueue_push(case when r.finished_at is not null then 'round_to_confirm' else 'round_live' end,
                          r.user_id, r.created_by, p_round);
  end loop;
end $$;
revoke all on function public._push_round_seats(uuid) from public, anon, authenticated;
