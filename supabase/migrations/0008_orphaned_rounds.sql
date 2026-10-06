-- A shared round outlives its creator while another registered player still has a seat in it. Once the last
-- registered player deletes their account, nobody can see it any more, so delete it instead of keeping an orphan.
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated'; end if;
  update rounds r set created_by = null
  where r.created_by = uid and r.finished_at is not null
    and exists (select 1 from round_players p where p.round_id = r.id and p.user_id is not null and p.user_id <> uid);
  delete from auth.users where id = uid;   -- cascades to profile, friendships, remaining rounds; seats become null
  delete from rounds r
  where r.created_by is null
    and not exists (select 1 from round_players p where p.round_id = r.id and p.user_id is not null);
end $$;
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;

-- One-off: remove orphans that already exist.
delete from public.rounds r
where r.created_by is null
  and not exists (select 1 from public.round_players p where p.round_id = r.id and p.user_id is not null);
