-- Discores milestone 1: profiles, courses/layouts/holes, rounds, round_players, scores.
-- Apply via the Supabase SQL editor or `supabase db push`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birth_year int not null check (birth_year between 1900 and 2100),
  gender text check (gender in ('female', 'male', 'nonbinary', 'self_described')),
  experience_years int check (experience_years between 0 and 80),
  home_area text,            -- coarse area label only (e.g. city), never exact coordinates
  age_confirmed_at timestamptz not null,
  is_pro boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: owner can update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- No insert policy: rows are created by the trigger below. No delete policy: use delete_account().

-- Prevent clients from granting themselves is_pro.
create or replace function public.profiles_protect_columns() returns trigger
language plpgsql as $$
begin
  if new.is_pro is distinct from old.is_pro and auth.uid() is not null then
    raise exception 'is_pro cannot be changed by clients';
  end if;
  new.age_confirmed_at := old.age_confirmed_at;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.profiles_protect_columns();

-- Create the profile when a user signs up. Sign-up metadata carries the profile fields.
-- Enforces the 13+ rule server side, so it cannot be bypassed by a modified client.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  b_year int := nullif(meta ->> 'birth_year', '')::int;
begin
  if b_year is null then
    raise exception 'birth_year is required';
  end if;
  if extract(year from now())::int - b_year < 13 then
    raise exception 'You must be at least 13 to use Discores';
  end if;
  if coalesce(meta ->> 'age_confirmed', 'false') <> 'true' then
    raise exception 'age confirmation is required';
  end if;

  insert into public.profiles (id, display_name, birth_year, gender, experience_years, age_confirmed_at)
  values (
    new.id,
    coalesce(nullif(trim(meta ->> 'display_name'), ''), split_part(new.email, '@', 1), 'Player'),
    b_year,
    nullif(meta ->> 'gender', ''),
    nullif(meta ->> 'experience_years', '')::int,
    now()
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------- courses
-- Course -> layout -> holes. Layouts are separate so verified layouts can be added later.
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text,                         -- public coarse label, e.g. "Austin, TX"
  location_approx point,             -- rounded (~1 km) for public use
  exact_location point,              -- never exposed through the API (see column grants)
  source text not null default 'user' check (source in ('osm', 'user', 'verified')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.course_layouts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  name text not null default 'Default',
  hole_count int not null check (hole_count between 1 and 36),
  verified boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.holes (
  layout_id uuid not null references public.course_layouts (id) on delete cascade,
  number int not null check (number >= 1),
  par int not null check (par between 2 and 6),
  distance_ft int,
  primary key (layout_id, number)
);

alter table public.courses enable row level security;
alter table public.course_layouts enable row level security;
alter table public.holes enable row level security;

create policy "courses readable" on public.courses for select to authenticated using (true);
create policy "layouts readable" on public.course_layouts for select to authenticated using (true);
create policy "holes readable" on public.holes for select to authenticated using (true);
-- Inserts and corrections arrive in milestone 2.

-- Keep exact coordinates out of anything the client can select.
revoke select on public.courses from authenticated, anon;
grant select (id, name, area, location_approx, source, created_at) on public.courses to authenticated;

-- ------------------------------------------------------------------ rounds
-- Round ids are client-generated UUIDs so rounds can be created offline and synced idempotently.
create table public.rounds (
  id uuid primary key,
  layout_id uuid not null references public.course_layouts (id),
  created_by uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.round_players (
  id uuid primary key,
  round_id uuid not null references public.rounds (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  guest_name text check (char_length(guest_name) between 1 and 40),
  position int not null default 0
  -- Either user_id or guest_name is set. If a user deletes their account, user_id becomes null
  -- and the row is shown as "Deleted player" (see delete_account note).
);
create index on public.round_players (round_id);
create index on public.round_players (user_id);

create table public.scores (
  round_player_id uuid not null references public.round_players (id) on delete cascade,
  hole_number int not null check (hole_number >= 1),
  strokes int not null check (strokes between 1 and 30),
  updated_at timestamptz not null,
  primary key (round_player_id, hole_number)
);

alter table public.rounds enable row level security;
alter table public.round_players enable row level security;
alter table public.scores enable row level security;

-- Milestone 1: creator only. Milestone 3 widens read access to every registered player in a finished round.
create policy "rounds: creator reads" on public.rounds for select using (created_by = auth.uid());
create policy "players: creator reads" on public.round_players for select
  using (exists (select 1 from public.rounds r where r.id = round_id and r.created_by = auth.uid()));
create policy "scores: creator reads" on public.scores for select
  using (exists (
    select 1 from public.round_players p join public.rounds r on r.id = p.round_id
    where p.id = round_player_id and r.created_by = auth.uid()));
-- Writes go through sync_round() only.

-- ---------------------------------------------------------------- sync RPC
-- payload: { round: {id, layout_id, started_at, finished_at},
--            players: [{id, user_id, guest_name, position}],
--            scores:  [{round_player_id, hole_number, strokes, updated_at}] }
-- Idempotent. Scores are last-write-wins per (player, hole) by updated_at.
create or replace function public.sync_round(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  r jsonb := payload -> 'round';
  rid uuid := (r ->> 'id')::uuid;
  existing_owner uuid;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select created_by into existing_owner from rounds where id = rid;
  if existing_owner is not null and existing_owner <> uid then
    raise exception 'round belongs to another user';
  end if;

  insert into rounds (id, layout_id, created_by, started_at, finished_at, updated_at)
  values (rid, (r ->> 'layout_id')::uuid, uid, (r ->> 'started_at')::timestamptz,
          nullif(r ->> 'finished_at', '')::timestamptz, now())
  on conflict (id) do update
    set finished_at = excluded.finished_at, updated_at = now();

  insert into round_players (id, round_id, user_id, guest_name, position)
  select (p ->> 'id')::uuid, rid,
         case when nullif(p ->> 'user_id', '') is null then null
              else uid end,                      -- M1: the only registered player the creator may add is themself
         nullif(p ->> 'guest_name', ''),
         coalesce((p ->> 'position')::int, 0)
  from jsonb_array_elements(coalesce(payload -> 'players', '[]'::jsonb)) p
  on conflict (id) do update set guest_name = excluded.guest_name, position = excluded.position;

  insert into scores (round_player_id, hole_number, strokes, updated_at)
  select (s ->> 'round_player_id')::uuid, (s ->> 'hole_number')::int,
         (s ->> 'strokes')::int, (s ->> 'updated_at')::timestamptz
  from jsonb_array_elements(coalesce(payload -> 'scores', '[]'::jsonb)) s
  where exists (select 1 from round_players rp where rp.id = (s ->> 'round_player_id')::uuid and rp.round_id = rid)
  on conflict (round_player_id, hole_number) do update
    set strokes = excluded.strokes, updated_at = excluded.updated_at
    where scores.updated_at < excluded.updated_at;
end $$;

revoke all on function public.sync_round(jsonb) from public, anon;
grant execute on function public.sync_round(jsonb) to authenticated;

-- ---------------------------------------------------------- account deletion
-- Required by App Store policy and our privacy goals. Milestone 3 changes this to anonymize
-- the user inside rounds other people share instead of deleting those rounds.
create or replace function public.delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid();   -- cascades to profiles and rounds
end $$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
