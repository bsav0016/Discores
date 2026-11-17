-- Weekly growth report: aggregate numbers only, for the person who runs the app.
--
-- The app has no analytics and the privacy policy says so. This is not analytics: it is a handful of counts the
-- database can already work out (new accounts, rounds, friends...), returned as one small JSON object to a caller who
-- holds a secret key. Nothing in it identifies a person, and no row is ever returned.
--
-- The key lives only as a SHA-256 hash in growth_report_key (set once, by hand, see docs/GROWTH_REPORT.md); the
-- caller sends the key, never the hash. With no hash stored, or a wrong key, the function refuses.
create table public.growth_report_key (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$')
);
alter table public.growth_report_key enable row level security;
revoke all on public.growth_report_key from public, anon, authenticated;   -- only the function below reads it

create or replace function public.growth_report(p_key text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  w0 timestamptz := now() - interval '7 days';   -- start of this week's window
  w1 timestamptz := now() - interval '14 days';  -- start of the one before
begin
  if p_key is null or length(p_key) < 16
     or not exists (select 1 from growth_report_key where hash = encode(sha256(convert_to(p_key, 'utf8')), 'hex')) then
    raise exception 'not allowed';
  end if;

  return jsonb_build_object(
    'generated_at', now(),
    'accounts', jsonb_build_object(
      'total', (select count(*) from profiles),
      'new_this_week', (select count(*) from profiles where created_at >= w0),
      'new_prev_week', (select count(*) from profiles where created_at >= w1 and created_at < w0)),
    'rounds', jsonb_build_object(
      'started_this_week', (select count(*) from rounds where started_at >= w0),
      'started_prev_week', (select count(*) from rounds where started_at >= w1 and started_at < w0),
      'finished_this_week', (select count(*) from rounds where started_at >= w0 and finished_at is not null),
      'with_friends_this_week', (select count(*) from rounds r where r.started_at >= w0
         and (select count(distinct p.user_id) from round_players p where p.round_id = r.id and p.user_id is not null) >= 2),
      'with_friends_prev_week', (select count(*) from rounds r where r.started_at >= w1 and r.started_at < w0
         and (select count(distinct p.user_id) from round_players p where p.round_id = r.id and p.user_id is not null) >= 2)),
    'players', jsonb_build_object(
      'active_this_week', (select count(distinct p.user_id) from round_players p join rounds r on r.id = p.round_id
                           where r.started_at >= w0 and p.user_id is not null),
      'active_prev_week', (select count(distinct p.user_id) from round_players p join rounds r on r.id = p.round_id
                           where r.started_at >= w1 and r.started_at < w0 and p.user_id is not null)),
    'friends', jsonb_build_object(
      'friendships_total', (select count(*) from friendships where status = 'accepted'),
      'accepted_new_this_week', (select count(*) from friendships where status = 'accepted' and created_at >= w0)),
    'notifications', jsonb_build_object('phones_registered', (select count(*) from push_tokens)),
    'courses', jsonb_build_object(
      'total', (select count(*) from courses),
      'confirmed_pars', (select count(*) from course_layouts where verified),
      'added_by_players_this_week', (select count(*) from courses where source = 'user' and created_at >= w0)),
    'errors', jsonb_build_object(
      'this_week', (select count(*) from client_events where kind in ('error', 'crash') and created_at >= w0),
      'prev_week', (select count(*) from client_events where kind in ('error', 'crash') and created_at >= w1 and created_at < w0)));
end $$;
revoke all on function public.growth_report(text) from public;
grant execute on function public.growth_report(text) to anon, authenticated;
