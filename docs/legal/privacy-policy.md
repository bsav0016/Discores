<!--
DRAFT. Written from what the app actually collects and does (see README and supabase/migrations). Have a lawyer
review it before launch, then replace every [PLACEHOLDER] below. After editing, run `node app/scripts/build-legal.mjs`
so the in-app copy matches. HTML comments like this one are not shown in the app.
-->
# Privacy Policy

Effective October 20, 2026

Discores is a free disc golf score tracker run by Savidge Apps ("we", "us"). This policy explains what we collect, why, who can see it, and how to delete it. You can reach us at savidgeapps@gmail.com.

## The short version

- We collect only what the app needs: an account, a name, your birth year, and your rounds and scores.
- We do not show ads, sell your data, or track you across other apps or websites.
- We do not use your location. Courses are found by searching their name.
- Other players never see your email, birth year or gender. Friends see your display name.
- When you are signed in, your rounds are saved to your account, so they come back if you reinstall the app or get a new phone.
- You can delete a round, or your whole account and data, inside the app at any time.

## What we collect

**Account.** Your email address and a password (stored only as a salted hash). If you sign in with Apple or Google, we receive your email address (which may be a private relay address from Apple) and, if you allow it, your name. We never see your Apple or Google password. If you use Apple, we also keep a token Apple gives us, only so that we can tell Apple to disconnect Discores when you delete your account.

**Profile.** Your display name, your birth year (not your full birthday), and a confirmation that you are 13 or older. Optional: gender, years playing disc golf, a username, and a setting that lets people find you by exact email address (off unless you turn it on). We also create a friend code for you.

**Rounds and scores.** The courses you play, the date, your scores, and the names of the other players in the round. Names of people without the app are typed in by whoever scores the round. While you are signed in, the app saves each round to your account and restores your rounds from it when you sign in on a new phone or after reinstalling. If you delete a round, we keep only its identifier, with the date you deleted it, for 90 days so that another device of yours cannot bring it back.

**Friends and safety.** Friend requests and friendships, people you have blocked, and reports you send about another person or a course, including any note you write.

**Courses.** If you add a course or suggest a correction, we keep what you submitted and the account that submitted it.

**Technical data.** Sign-in sessions and counters that limit how fast friend lookups can be tried. We do not run analytics or advertising software, and we do not collect your device identifiers or IP address for our own use. Our hosting provider may keep ordinary server logs.

**Camera.** If you tap "Scan a friend's QR code", the app uses the camera to read the code. Nothing is recorded, saved or sent.

**Guest mode.** If you use the app without an account, your rounds stay on your phone and nothing is sent to us. If you later create or sign in to an account, the app asks before it adds those rounds to it.

## How we use it

To run the app: sign you in, keep your rounds saved to your account and in sync across your devices, let you play with friends, show history and stats, keep people safe (limit abuse, review reports), and fix problems. We do not use your data to train models or for advertising.

## Who can see what

- **Friends and people with your code.** Anyone who has your friend code can send you a friend request, and the request shows your display name. If you set a username, anyone who types it exactly can send a request. If you turn on email lookup, anyone who types your exact email address can send a request. Nobody can browse or search a list of users.
- **Players in your rounds.** When someone scores a round that includes you, you are asked to confirm your scores first. Only after you confirm does the round appear in your history and stats, and then it shows each player's display name and scores. If you decline, your name stays on their round as plain text with no link to your account.
- **Course contributions.** Courses you add are visible to everyone, without your name.
- **Blocking.** Someone you block can no longer find you or send you requests, and cannot tell that they were blocked.
- **Us.** A small number of administrators can see reports and the names involved, in order to review them. Reports are the only place we look at individual people's data.

We do not share your personal information with anyone for their own purposes.

## Service providers

We use these providers to run Discores. They handle data only for us:

- **Supabase** hosts our database, sign-in and server code in the United States.
- **Apple and Google** if you choose to sign in with them, and the app stores that distribute the app.
- **Expo** builds the app. The app does not send your usage data to Expo.

Course data comes from OpenStreetMap contributors (ODbL), Overture Maps Foundation (CDLA Permissive 2.0) and Foursquare Labs, Inc. (Apache 2.0). It describes places, not people.

## Keeping and deleting data

We keep your data while your account exists. A round you delete in the app is removed from your account and from your friends' view of your scores, but a friend who confirmed their own scores in it keeps those scores (without your name on the round). We keep the deleted round's identifier for 90 days, then it is cleared. You can delete your account in the app: Settings > Delete account and data. When you do:

- Your profile, email or Apple/Google sign-in (and Apple's token, which we revoke), friends, blocks, friend requests and course suggestions are deleted.
- Rounds you scored that include other registered players stay in their history, and your name on them is replaced with "Deleted player". Your other rounds are deleted.
- Courses you added stay, without any link to you.
- Reports you sent stay with your name removed. Reports about you may be kept so that we can keep people safe.
- The identifiers we kept for rounds you deleted are removed.
- A username you used is not reserved for you afterward.

Your rounds are saved to your account so you can restore them, which means they are held on our servers until you delete them or your account. We do not keep separate backup copies beyond the 90 days for deleted rounds described above. If you cannot use the app, email savidgeapps@gmail.com from the address on the account and we will delete it.

## Your choices and rights

You can change your name, username and email-lookup setting in the app. You can ask us for a copy of your data, or to correct it, by emailing savidgeapps@gmail.com. Depending on where you live (for example California, or the EU and UK) you may have additional rights, and we will honor them. You can also complain to your local data protection authority.

## Children

Discores is for people 13 and older. We ask for your birth year when you sign up, and an account under 13 is not allowed. If we learn that a child under 13 has an account, we will delete it. If you think this has happened, email us.

## Security

Passwords are hashed. Data is sent over encrypted connections, and access to each table is limited by database rules so that people can read only what they should. No system is perfectly secure, so please use a strong password that you do not use elsewhere.

## Changes

If we change this policy in a way that matters, we will tell you in the app before it takes effect. The date at the top shows the latest version.

## Contact

Savidge Apps, savidgeapps@gmail.com
