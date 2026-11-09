-- Admin view of the error log (migration 0026): what is failing, how often, and since when. Read-only, admins only.
-- Returns one row per kind, code, platform and app version over the last p_days days (1 to 30), most frequent first,
-- at most 100 rows. It carries nothing that identifies a person because the log holds nothing like that.
create or replace function public.list_error_summary(p_days integer default 7)
returns table (kind text, code text, platform text, app_version text, n bigint, first_seen timestamptz,
               last_seen timestamptz, sample text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'not allowed'; end if;
  return query
  select e.kind, e.code, e.platform, e.app_version, count(*), min(e.created_at), max(e.created_at),
         (array_agg(e.message order by e.created_at desc))[1]
  from client_events e
  where e.created_at >= now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30))
  group by e.kind, e.code, e.platform, e.app_version
  order by count(*) desc, max(e.created_at) desc
  limit 100;
end $$;
revoke all on function public.list_error_summary(integer) from public, anon;
grant execute on function public.list_error_summary(integer) to authenticated;
