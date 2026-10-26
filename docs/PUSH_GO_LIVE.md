# Turning on push notifications

Everything for push notifications is in the code, but nothing is switched on in the live Supabase project, and the
app build that can receive them has not been made. This is the order to do it in. Each step says what it changes and
how to undo it. Steps 1 to 6 touch the live project; do them together, in order, and stop if a check fails.

Pieces: migration `0020` (tables, rules, triggers), the `send-push` Edge Function, the per-minute schedule
(`supabase/go-live/push-schedule.sql`), and the app (`expo-notifications`, Settings, tap routing). Design notes are in
the README and `docs/SETUP.md`.

## Before you start (accounts, nothing live yet)

- [ ] **Apple push key.** An EAS iOS build with the notifications plugin asks to create the push key for you when you
      run it interactively (`eas build --platform ios --profile production`, sign in with your Apple developer
      account). Or manage it with `eas credentials`.
- [ ] **Android (Firebase).** Create a Firebase project, add the Android app `com.discores.app`, and download
      `google-services.json`. Put the file in `app/`, add `"googleServicesFile": "./google-services.json"` under
      `android` in `app/app.json`, and upload the FCM V1 service-account key to EAS (`eas credentials` >
      Android > Google Service Account > FCM V1). Without this the Android app still works but cannot get a push
      token, so Android people get no notifications. iOS is unaffected.
- [ ] **Expo access token (optional).** Only if you turn on "enhanced push security" in the Expo account; then set it
      as `EXPO_ACCESS_TOKEN` in step 3.
- [ ] **Privacy policy.** Read `docs/legal/privacy-policy.md` (it was drafted, not reviewed), set the effective date to
      the release date, run `node app/scripts/build-legal.mjs` and `node app/scripts/build-site.mjs`, and publish
      `site/` at the public URL the stores use. The new text must be public before the notification build is.

## 1. Apply migration 0020 (live, additive)

Run `supabase/migrations/0020_push_notifications.sql` and record it as version `0020`, the same way 0017 to 0019 were
applied. It adds tables, functions and triggers and two columns on `profiles` (both default on). It changes no
existing function.

Check: `select to_regclass('public.push_tokens'), to_regclass('public.push_outbox');` returns both;
`select count(*) from pg_trigger where tgname in ('friendships_push','rounds_push','round_players_push');` returns 3;
signed in as an ordinary account, selecting from `push_tokens` is refused.

Undo: nothing needs undoing; with no phones registered the triggers queue nothing. To remove it entirely, drop the three
triggers, the two tables and the functions named in the migration, and the two `profiles` columns.

## 2. Enable the extensions

Dashboard > Database > Extensions: `pg_cron` and `pg_net` (the schedule file also does this with
`create extension if not exists`). Check: both appear as installed.

## 3. Set the function secrets

Pick a long random string (for example `openssl rand -base64 32`) and use it twice: here and in step 6.

```
supabase secrets set PUSH_SECRET=<the string> --project-ref ygewircfvsadazpwxquv
supabase secrets set EXPO_ACCESS_TOKEN=<token> --project-ref ygewircfvsadazpwxquv   # only if you use one
```

## 4. Deploy the function

```
supabase functions deploy send-push --no-verify-jwt --project-ref ygewircfvsadazpwxquv
```

`--no-verify-jwt` is intended: the function checks `PUSH_SECRET` itself (the scheduler is not a signed-in user).

Check (the secret stays in your shell; do not paste it anywhere):

```
curl -s -X POST https://ygewircfvsadazpwxquv.supabase.co/functions/v1/send-push                       # expect {"ok":false,"reason":"unauthorized"}
curl -s -X POST -H "x-push-secret: $PUSH_SECRET" https://ygewircfvsadazpwxquv.supabase.co/functions/v1/send-push   # expect {"ok":true,"sent":0,...}
```

Undo: `supabase functions delete send-push --project-ref ygewircfvsadazpwxquv`.

## 5. Build and test on real phones (before scheduling)

- [ ] Build the app with the notifications plugin (a normal `production` or `preview` EAS build) and install it on
      two phones with two test accounts that are friends.
- [ ] Phone A: open the app, accept the "Get notified?" question. In SQL: `select user_id, platform from push_tokens;`
      shows A.
- [ ] Phone B sends A a friend request. Run the function by hand (the second curl above): response shows `"sent":1`
      and A gets "B sent you a friend request." Tapping it opens Friends.
- [ ] B scores and finishes a round with A in it. Run the function again. A gets "B scored a round with you. Confirm
      your scores." Tapping opens the confirm screen, also from a closed app.
- [ ] In Settings > Notifications, turn "Rounds to confirm" off on A, repeat: nothing is queued.
- [ ] Sign out on A: its row disappears from `push_tokens`.
- [ ] iOS and Android both, if Android credentials are done.

## 6. Schedule it

1. Store the secret in Vault: `select vault.create_secret('<the string from step 3>', 'push_secret');`
2. Run `supabase/go-live/push-schedule.sql`.
3. Check the three queries at the bottom of that file after a few minutes: the job is active, runs succeed, and any
   call returns status 200.

Undo: run `supabase/go-live/push-unschedule.sql`.

## 7. Release 1.1.0

- [ ] Bump the version to 1.1.0 (`app/app.json` and `app/package.json`), as the 1.0.1 release did.
- [ ] Build and submit with EAS (`production` profile, iOS and Android).
- [ ] App Store Connect: update the App Privacy answers (see `docs/store/listing.md`; confirm how Apple wants push
      tokens declared). Play Console: update Data safety. Add the 1.1.0 release notes.
- [ ] Watch `push_outbox` for a day: `select kind, count(*), count(*) filter (where sent_at is null) from push_outbox
      group by 1;` rows should be sent within a minute or two.

## If something goes wrong

Run `push-unschedule.sql`. The app keeps working; people stop getting notifications. Old app versions are unaffected by
everything here.

## Known limits

- A message is sent at most once; if the phone is off or Expo's service drops it after accepting it, it is not
  retried. Expo's later delivery receipts are not checked, so a token that turns dead is only removed the next time
  Expo refuses it at send time.
- If Expo cannot be reached, rows are retried on the next run, for up to a day.
- At most 10 notifications an hour per person are queued; anything beyond that is dropped, not delayed.
