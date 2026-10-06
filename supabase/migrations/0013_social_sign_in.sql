-- Sign in with Apple / Google creates an auth user with no birth year, so the age gate in handle_new_user()
-- cannot run at that point. Social accounts get no profile until the person finishes complete_profile(), which
-- applies the same rules (13 or older, explicit confirmation). Email sign-ups are unchanged.

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  b_year int := nullif(meta ->> 'birth_year', '')::int;
begin
  if coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email' then
    return new; -- profile is created by complete_profile()
  end if;
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

-- Returns 'ok' | 'exists' | 'invalid' | 'underage' | 'not_signed_in'. Under 13 deletes the just-created account
-- so nothing about a child is kept.
create or replace function public.complete_profile(p_display_name text, p_birth_year int, p_age_confirmed boolean)
returns text
language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  nm text := trim(coalesce(p_display_name, ''));
  this_year int := extract(year from now())::int;
begin
  if uid is null then return 'not_signed_in'; end if;
  if exists (select 1 from profiles where id = uid) then return 'exists'; end if;
  if not coalesce(p_age_confirmed, false) or p_birth_year is null or p_birth_year < 1900
     or p_birth_year > this_year or char_length(nm) not between 1 and 40 then
    return 'invalid';
  end if;
  if this_year - p_birth_year < 13 then
    delete from auth.users where id = uid;
    return 'underage';
  end if;
  insert into profiles (id, display_name, birth_year, age_confirmed_at) values (uid, nm, p_birth_year, now());
  return 'ok';
end $$;

revoke all on function public.complete_profile(text, int, boolean) from public, anon;
grant execute on function public.complete_profile(text, int, boolean) to authenticated;
