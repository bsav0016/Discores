# Discores

Free disc golf score tracking: frictionless round sharing, local leagues, generous history.

- `app/` – Expo (React Native, TypeScript, Expo Router) mobile app
- `supabase/` – Postgres migrations and dev seed data

## Milestone 1 setup

### 1. Supabase project
1. Create a project at https://supabase.com.
2. SQL editor: run `supabase/migrations/0001_init.sql`, `0002_lock_down_functions.sql`, `0003_courses.sql` and `0004_review_corrections.sql`, `0005_overture_import.sql`, `0006_friends_and_sharing.sql`, `0007_friend_attempts_fix.sql`, `0008_orphaned_rounds.sql`, `0009_find_by_email.sql`, `0010_usernames.sql`, `0011_block_and_report.sql` and `0012_guest_course_search.sql` and `0013_social_sign_in.sql` and `0014_apple_tokens.sql` and `0015_confirm_shared_rounds.sql` and `0016_performance.sql` in order, then `supabase/seed.sql` (dev-only sample courses).
   Optional, to load real courses from OpenStreetMap: `node supabase/osm/import-osm.mjs --region US-KY out.sql` (any ISO 3166-2 code; a `<south> <west> <north> <east>` box also works), then run `out.sql` in the SQL editor. It is safe to re-run. Data is © OpenStreetMap contributors (ODbL); the app shows the attribution.
   OSM is thin outside big cities, so also load Overture Maps (more courses, with towns): `pip install duckdb`, then `python supabase/overture/import-overture.py --state KY --bbox -89.6 36.45 -81.9 39.2 out.sql` and run `out.sql` in the SQL editor. Courses within 400 m of an existing one are skipped, so it mixes safely with OSM and user-added courses. Overture data is CDLA Permissive 2.0 (Foursquare rows also need their copyright notice); `supabase/overture/kentucky.sql` is the Kentucky load.
   Whole US: `supabase/overture/us/` holds one file per state (49 states plus the separate Kentucky file, about 1,960 courses). The current Supabase project already has all of them loaded. Open each file in the SQL editor and run it (any order; each returns how many courses it added), or with psql: `for f in supabase/overture/us/*.sql; do psql "$DATABASE_URL" -f "$f"; done`. Then run `supabase/overture/after-load.sql` to review the results. Regenerate with `python supabase/overture/import-overture.py --state US --per-state --skip KY supabase/overture/us`.
   To review course reports in the app, make yourself an admin after you sign up: `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`. Settings then shows **Review course reports**.
3. Authentication → Providers → Email. For quick local testing, turn **Confirm email** off
   (turn it back on before launch).
4. Project Settings → API: copy the **Project URL** and the **anon/publishable key**.
   Never put the service-role key in the app.

### 2. App
```bash
cd app
cp .env.example .env      # fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY
npm install
npx expo start --android  # emulator; press `a` in the Expo CLI
```

### 3. Checks
```bash
npm test            # unit tests (scoring, sync engine)
npm run typecheck
npx expo-doctor
```

## How offline sync works
Rounds, players and scores are written to on-device SQLite first (client-generated UUIDs). A round is
flagged dirty with every change; `sync_round()` on the server upserts it idempotently (scores are
last-write-wins per player+hole). Sync runs after sign-in, on app foreground, when connectivity returns,
and when a round finishes. Failed pushes stay dirty and retry.

## Friends and shared rounds
Everyone has an 8-character friend code (Friends tab), shown with a QR code and a shareable invite link (`discores://friend/CODE`; opening it asks before sending a request). Adding someone's code sends a request; once they accept,
either of you can add the other as a registered player when scoring. Friends are added by code, or by exact email for
people who turned on "Let people find me by email" in Settings (off by default; no browsing and no name search).
People can also set an optional username (3-20 letters, numbers, underscores; changeable once every 30 days, and a
released name is held for 30 days) and be added by typing `@username`. All three lookups are exact-match only and
share one rate limit; a miss never reveals whether an account exists.

People can be reported (harassment, impersonation, offensive name, spam, other) or blocked from the Friends tab
("More", or "Report or block" on a request). Blocking removes any friendship, makes the blocker unfindable to that
person, and is undone from the Blocked list. Reports go to an admin queue (Settings > Review reports > People),
where an admin can remove a username, reset a display name, or dismiss. Make someone an admin by adding their user
id to the `admins` table. When a round with registered players is finished and
synced, each registered player is asked to confirm their own scores first (Rounds tab banner and badge, "Confirm scores" screen; migration 0015). Only a confirmed round appears in their history and stats as a read-only "Shared with you" round; declining unlinks the seat from their account and leaves their name as plain text on the scorer's round. The scorer sees each friend's status (waiting, confirmed, declined) on the finished round (display names only, no
ids or emails). If an account is deleted, rounds shared with other registered players stay and the deleted
player shows as "Deleted player"; rounds nobody else is in are deleted.

## Sign in with Apple
iPhone builds show "Continue with Apple" on the sign-in screen (`expo-apple-authentication`, `usesAppleSignIn`).
Setup: in the Supabase dashboard go to Authentication > Providers > Apple, enable it and add `com.discores.app`
under "Authorized Client IDs" (native sign-in needs no secret key). The first time someone signs in with Apple (or
any non-email provider) they have an account but no profile; `complete_profile()` creates it after the app asks for
a display name, birth year and the 13+ confirmation (under 13 deletes the account). Email sign-up is unchanged.

## Sign in with Google
"Continue with Google" opens Google in the system browser (`signInWithOAuth` + `expo-web-browser`) and reads the
session from the redirect (`discores://auth-callback`), so it works on Android and iPhone with one setup.
1. Google Cloud Console: create an OAuth client of type "Web application". Add
   `https://xxllvzbrwltjqoewsefi.supabase.co/auth/v1/callback` as an authorized redirect URI.
2. Supabase dashboard > Authentication > Providers > Google: enable it and paste the client id and secret.
3. Supabase > Authentication > URL Configuration > Redirect URLs: add `discores://**` (and `exp://**` if you
   want it to work inside Expo Go while developing).
Google users go through the same `complete_profile()` age check as Apple users. If the provider is not enabled the
browser shows Supabase's error instead of the sign-in page.

## Legal documents
The Privacy Policy and Terms of Service are drafts in `docs/legal/` (markdown). They are bundled into the app by
`node app/scripts/build-legal.mjs` and shown at Settings > Terms/Privacy and on the sign-in, sign-up and profile
screens. Before launch: replace every `[PLACEHOLDER]`, have a lawyer review them, re-run the script, and host the
same text at a public URL (both app stores ask for one).

## Account deletion and Apple token revocation
Settings > Delete account and data calls the `delete-account` Edge Function (`supabase/functions/`), which revokes
the person's Sign in with Apple token and then runs the `delete_account()` SQL function as them. If the function
cannot be reached the app falls back to calling `delete_account()` directly, so deletion never depends on Apple.
After an Apple sign-in the app sends Apple's one-time code to `apple-link`, which exchanges it for a refresh token
and stores it in `apple_tokens` (service role only, migration 0014). Both functions are deployed with JWT
verification on. They need these secrets (Supabase dashboard > Edge Functions > Secrets, or
`supabase secrets set`): `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (the whole .p8 file) and optionally
`APPLE_CLIENT_ID` (defaults to `com.discores.app`). Until they are set, `apple-link` answers `not_configured` and
nothing is stored. Create the key in the Apple developer portal: Certificates, IDs & Profiles > Keys > "+" > Sign in
with Apple, choosing the `com.discores.app` App ID.

## Public web pages
`node app/scripts/build-site.mjs` turns `docs/legal/*.md` into plain HTML in `site/` (home, privacy policy, terms,
and a page explaining how to delete an account and data, which Google Play requires). Upload `site/` to any static
host. Re-run it after editing the documents.

## Forgot and change password
Sign-in has "Forgot password?": it sends Supabase's reset email (always the same on-screen answer, so it cannot be
used to find out who has an account). The link opens the app (`discores://reset-password`), which signs in with the
session in the link and shows "Choose a new password" before anything else; saving also signs out other devices.
Settings > Change password asks for the current password first (email accounts only). One-time Supabase setup:
Authentication > URL Configuration > Redirect URLs must contain `discores://**` (add `exp://**` to try it in Expo
Go, although Expo Go does not deliver the link's token to the app, so test with a development or preview build).
The default Supabase email sender allows only a few emails an hour; set up your own SMTP (Authentication >
Emails > SMTP Settings) before real users, and edit the "Reset Password" template if you want it branded.

## Icons, store listing and CI
`node app/scripts/make-icons.mjs` draws every icon in `app/assets/` (a white disc with a ring on brand green; the store
icon is written without an alpha channel as Apple requires). Replace them with a designed icon whenever you have one.
`docs/store/listing.md` holds draft store text, privacy-label answers and review notes. GitHub Actions
(`.github/workflows/ci.yml`) runs the type check and tests on every push and fails if `docs/legal` was edited without
regenerating the in-app text and `site/`.

## Stats
The Stats tab is computed on the phone from finished rounds (your own seat only, shared rounds included), so it
works offline and for guests: rounds and holes played, best round, a split of eagle/birdie/par/bogey/double, and
per course the best and average full round, the last 10 rounds against par and your average on each hole.
Best and average count only rounds where every hole was scored. The logic is in `app/src/domain/stats.ts`.

## Guest mode
"Try it without an account" on the sign-in screen lets someone score rounds and search courses with no account.
Guest rounds live only in the on-device database under a placeholder owner id and are never sent to the server.
Signing in or up asks whether to add them to that account; if you agree they sync like any other round, otherwise they stay on the device. Friends, adding courses,
reports and usernames need an account. Guests can read course data through the anon policies in migration 0012.

## Known gaps (planned)
- Course search/add/corrections and the OpenStreetMap import (milestone 2)
- Google/Apple sign-in (milestone 6; needs EAS dev builds)
- Shared rounds are read-only for everyone but the scorer; no friend search by name; milestone 3 was tested on Android only
