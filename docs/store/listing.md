# Store listing drafts

Copy these into App Store Connect and the Google Play Console. Text only claims what the app does today. Replace
anything in [BRACKETS]. Limits are in parentheses.

## Names and short text

| Field | Text |
| --- | --- |
| Apple name (30) | Discores |
| Apple subtitle (30) | Disc golf scores with friends |
| Google title (30) | Discores: Disc Golf Scorecard |
| Google short description (80) | Free disc golf scorecard. Keep score offline and play with friends. |
| Apple promotional text (170) | Keep your disc golf score on the course, even with no signal. Add friends, share rounds, and see how you play each hole. Free, with no ads. |
| Apple keywords (100) | disc golf,scorecard,frisbee golf,score,udisc,pdga,course,round,tracker,friends |
| Category | Sports (Apple primary; Google "Sports"). Leave Apple's secondary category empty |
| Price | Free, no in-app purchases |

The keywords field names other brands and orgs. Remove "udisc" and "pdga" if you prefer to avoid any trademark
question; the other keywords are generic.

## Full description (use for both stores, 4000 limit)

Discores is a free disc golf scorecard that works on the course, even when you have no signal.

SCORE A ROUND IN SECONDS
- Pick your course, add up to 8 players, and tap to score each hole.
- Works offline. Your round is saved on your phone and syncs when you are back online.
- Add guest players by name for people who don't have the app.

PLAY WITH FRIENDS
- Add friends with a friend code, a QR code, a share link, or an optional username.
- Score a round for your whole group. Each friend gets to check their own scores and confirm them before the round
  is added to their history, so nobody ends up with a score they didn't play.

KNOW YOUR GAME
- See your rounds, your best score at each course, and how you do on every hole.
- A simple breakdown of birdies, pars, bogeys and worse.

FIND YOUR COURSE
- Search courses by name or city. Missing or wrong? Add a course or suggest a fix.

YOUR PRIVACY, YOUR CALL
- No ads and no tracking. We never sell your data.
- Nobody can browse a list of users. People can only find you with your friend code, or your exact username or
  email if you choose to allow that.
- Block or report anyone, and delete your account and data any time in Settings.
- Try it first: you can score rounds as a guest without an account.

Discores is free. Course data comes from OpenStreetMap contributors, Overture Maps Foundation and Foursquare Labs.

## URLs and contact

| Field | Value |
| --- | --- |
| Privacy policy URL | https://bsav0016.github.io/Discores/privacy.html |
| Terms URL (Apple, optional) | https://bsav0016.github.io/Discores/terms.html |
| Account deletion URL (Google) | https://bsav0016.github.io/Discores/delete-account.html |
| Support URL / email | savidgeapps@gmail.com |
| Marketing URL (optional) | https://bsav0016.github.io/Discores/index.html |

## Apple: age rating and review

- **Age rating:** answer the questionnaire truthfully. The app has user-created names and friend-to-friend features
  but no chat, no web browsing and no mature content, so it should land around 12+ (user-generated content). If Apple
  asks about messaging or user content, the only user text is display names, usernames, optional report notes, and
  guest player names.
- **Sign in with Apple:** offered next to Google and email sign-in, as the guidelines require.
- **User-generated content (guideline 1.2):** the app has report and block on every person (Friends tab), an admin
  review queue, and a published contact address. Be ready to act on reports promptly; Apple expects it.
- **Account deletion (5.1.1v):** Settings > Delete account and data, which also revokes the Sign in with Apple token
  once the Apple key secrets are set in Supabase (see the README).
- **Demo access for the reviewer:** create a test account (email and password) and put it in "App Review Information".
  The reviewer can also use "Try it without an account". Add this note: "Friends need two accounts. Create a second
  account to see friend requests and score confirmation."
- **Camera:** used only to scan a friend's QR code. Purpose string: "Discores uses the camera only to scan a friend's
  QR code."

## Apple: App Privacy ("nutrition label")

Data collected, all linked to the user, none used for tracking, none shared with third parties for their own use:

| Data type | Why |
| --- | --- |
| Email address | Account, sign-in |
| Name (display name) | Shown to friends |
| User ID | Account |
| Other user content (scores, rounds, usernames, report notes) | App functionality |
| Gender (optional), birth year | Profile (birth year for the age check) |

Not collected: location, contacts, photos, browsing history, device identifiers, advertising data, diagnostics.

## Google Play: Data safety

- **Collects data:** yes. **Shares data with third parties:** no (service providers acting for us do not count as
  sharing). **Data encrypted in transit:** yes. **Users can request deletion:** yes (in-app and the deletion URL).
- **Data types:** Personal info (name, email address, user IDs, other info: birth year, gender), App activity (other
  user-generated content: rounds, scores, reports). Purpose for all: App functionality and Account management.
  Optional: gender, username.
- **Not collected:** location, financial, health, messages, photos, audio, contacts, web history, device IDs.
- **Content rating (IARC):** fill in honestly; user interaction is limited to friend requests and shared rounds.
- **Target audience:** 13+ (the app does not allow under 13). Not designed for children.
- **Permissions:** Camera (QR scanning only). Internet and network state.

## Screenshots to prepare

Both stores need real screenshots. Suggested set (6): scoring a hole, the finished round, the Rounds list, Stats, the
Friends tab with the QR code, and "Confirm scores".
- **Apple:** at least one set at 6.9" (1320 x 2868) or 6.5" (1284 x 2778); a set from an iPhone or Simulator.
- **Google:** phone screenshots with a long side no more than twice the short side (the emulator's 1080 x 2400 is a
  little too tall; crop or use a 9:16 device), 2 to 8 images. A 1024 x 500 feature graphic is also required.
- Add the Google "app icon" (512 x 512) from `app/assets/icon.png`, resized.

## Before you submit

- [ ] Replace every placeholder here and in docs/legal, then re-run the two build scripts.
- [ ] Host the site and paste the URLs above.
- [ ] Run `node app/scripts/make-icons.mjs` only if you change the icon design; consider a custom icon later.
- [ ] Production builds: `eas build --platform ios --profile production` and `--platform android --profile production`
      (Android produces the .aab file Google Play wants).
