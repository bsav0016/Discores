# Discores operations: backups and restore

What to do if the Supabase project loses data, and how to prove the plan works. Nothing here needs a third-party service.

## What holds data

| Where | What | Backed up by |
|---|---|---|
| Supabase Postgres, `public` schema | profiles, rounds, scores, courses, friends, reports, push tokens | Supabase backups and the manual dump below |
| Supabase Postgres, `auth.users` | accounts (email, provider ids, password hashes) | Same, but only the manual dump below can be restored selectively |
| Edge Function secrets | Apple key, `PUSH_SECRET` | Not in any dump. Keep them in your password manager |
| On-device SQLite | each phone's copy of its rounds | Re-uploads to the server on the next sync, so a phone is also a partial backup |

Code, migrations and the course import files are in git, so the schema and the course list can always be rebuilt.

## 1. Backup retention check (needs the Supabase dashboard)

Confirm and write down the answers here, with the date checked:

- [ ] Plan (Free, Pro, ...): ____
- [ ] Project Settings > Database > Backups: daily backups on? retention (days): ____
- [ ] Point-in-time recovery (paid add-on) on? ____
- [ ] Decision: if the plan has no daily backups or PITR, either upgrade before the wider launch or run the manual dump below on a schedule (weekly is enough for the current size).
- [ ] Last checked: ____

Free projects have no downloadable backups, so on the Free plan the manual dump is the only backup.

## 2. Manual dump

Get the connection string from Project Settings > Database (use the direct or session-pooler string, not the transaction pooler, and keep it out of git). Use `pg_dump` 17 or newer.

```bash
export DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
stamp=$(date +%F)
pg_dump "$DATABASE_URL" --no-owner --no-privileges --schema=public -Fc -f "discores-public-$stamp.dump"
pg_dump "$DATABASE_URL" --no-owner --no-privileges --data-only --table=auth.users -Fc -f "discores-users-$stamp.dump"
```

Why two files: Supabase owns the `auth` and `extensions` schemas, so a whole-database dump cannot be restored into a new project (it fails on `CREATE SCHEMA auth`). Only `public` and the rows of `auth.users` are yours.

Store the files somewhere private and encrypted. They contain emails and password hashes. Delete old ones, and remember that deleted accounts survive in old dumps: after a restore, repeat any account deletions made since the dump was taken.

## 3. Restore

Restore into a new Supabase project (or a scratch Postgres to rehearse). In order:

1. Apply the schema's prerequisites. A new Supabase project has `auth` and `extensions`; a scratch Postgres needs `supabase/tests/stubs.sql` first.
2. Create the extensions the dump relies on, because `--schema=public` does not carry them:
   `create extension if not exists pgcrypto; create extension if not exists pg_trgm with schema extensions;`
   (the same statements as migrations 0001 and 0003).
3. Load the users first, without firing triggers (the `on_auth_user_created` trigger would otherwise create blank profiles that clash with the restored ones):
   `pg_restore -d "$TARGET" --no-owner --disable-triggers discores-users-<date>.dump`
4. Load the public schema and data:
   `pg_restore -d "$TARGET" --no-owner discores-public-<date>.dump`
   One error is expected and harmless: `schema "public" already exists`. Any other error is a failure.
5. Recreate the trigger on `auth.users`, which lives in the `auth` schema and so is not in the dump: re-run the `create trigger on_auth_user_created ...` statement from `supabase/migrations/0001_init.sql` (and any later migration that redefines it).
6. Redeploy the three Edge Functions and set their secrets again (`docs/SETUP.md`), then re-enable the push schedule only if it was on (`supabase/go-live/push-schedule.sql`).
7. Re-add Auth providers and redirect URLs (`docs/SETUP.md`), point the app's `EXPO_PUBLIC_SUPABASE_URL` and key at the new project if the project changed (needs a new build), and make yourself an admin again if needed.
8. Verify (below), then let people sign in. Phones re-upload anything newer than the dump on their next sync.

Verify: row counts for `profiles`, `rounds`, `round_players`, `scores`, `courses` match the source (or the latest known numbers), the function count and policy count match, then sign in with a test account and open the history screen.

## 4. Restore drill log

A drill is not done until it has been run and written down. Re-run it after any migration that adds a table, trigger or extension, and at least once a year.

### 2026-11-08: scratch Postgres (stand-in for production)

Setup: `postgres:17` in Docker; `supabase/tests/stubs.sql`, all 25 migrations and `supabase/seed.sql` applied to database `src`; one test user added; then the dump and restore steps above into empty database `restored`.

| Check | `src` | `restored` |
|---|---|---|
| user-defined functions in `public` | 50 | 50 |
| indexes in `public` | 50 | 50 |
| RLS policies | 12 | 12 |
| tables in `public` | 19 | 19 |
| courses / profiles / users | 2 / 1 / 1 | 2 / 1 / 1 |
| triggers | 6 | 5 |

What the drill found, now fixed in the steps above:

1. A whole-database dump fails to restore (the `auth` schema already exists), hence the two-file dump.
2. `--schema=public` leaves out extensions, so two trigram indexes failed until `pg_trgm` was created first (step 2).
3. The one missing trigger is `on_auth_user_created` on `auth.users` (step 5).

Not covered: this drill used a scratch database, not the real project, so it proves the procedure and not the live backups. The checklist in section 1 and one real restore of a live dump into a throwaway Supabase project are still to be done by the owner (needs dashboard access); record the result here.
