-- Minimal stand-ins for the parts of Supabase that the migrations rely on, so they can run on plain Postgres.
-- This is a test fixture only: it is never applied to a real project.
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, public;

create schema if not exists auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz default now()
);
-- Supabase reads the signed-in user from the request's JWT claims; tests set that setting directly.
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
grant usage on schema auth to anon, authenticated;
