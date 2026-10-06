-- Found by the Supabase security advisors after applying 0001.
-- handle_new_user is a trigger function; it must not be callable through /rest/v1/rpc.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
alter function public.profiles_protect_columns() set search_path = public;
