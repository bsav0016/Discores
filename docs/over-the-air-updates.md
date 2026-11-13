# Over-the-air updates

The Expo app is in `app/`: run every `npm` and `npx` command below from that folder.

Discores can ship JavaScript and asset fixes without a store release, through EAS Update. Nothing is published automatically: you run `npm run update:*` yourself, and CI has no Expo credentials on purpose.

## Read this first: the next store build is what turns updates on

`expo-updates` is a native module. Builds that were made before it was added **cannot receive updates**, and no update can reach them. The first build that can is the next store build, so:

1. Give that build a **new app version** (for example bump the patch number in `app.json`). `runtimeVersion` follows the app version, so an update is only delivered to builds of the same version, and every build on one version should contain the same native code.
2. Build and submit it as usual (`npx eas-cli build --profile production`, then `npx eas-cli submit`).
3. Only after that build is live can `npm run update:production` reach anyone.

Until then these scripts publish to a channel nobody listens to. That is harmless, but it does nothing.

## What can ship over the air

| Change | How it ships |
| --- | --- |
| Screens, copy, logic, images and data bundled in the app | `npm run update:production`: installed apps download it on a launch and apply it on the next |
| A native library, new permissions, native `app.json` settings, a new Expo SDK | Store release with a new version number |

**Rule of thumb:** if the change could not run in the app that is already installed, it is a store release. When unsure, it is a store release. Dependabot bumps of native packages are store releases.

## Publishing

1. Make the change on a branch and open a PR as usual.
2. Try it on preview first. From your branch (inside `app/`) run `npm run update:preview`. It refuses to run with uncommitted changes, runs typecheck, the tests and a bundle check, then publishes to the `preview` channel. Open a preview build (`npx eas-cli build --profile preview`), force-quit and reopen the app twice (the update downloads on the first launch and applies on the second), and check the fix.
3. Merge the PR, then from an up-to-date `main`: `git checkout main && git pull && npm run update:production`. It refuses unless you are on `main`, the tree is clean and `HEAD` equals `origin/main`, so production gets exactly what was merged.
4. Add `-- --dry-run` to either command to run every check and print the publish command without publishing.

You need `npx eas-cli login` (the Expo account that owns the project) first.

## Rolling back

1. `npx eas-cli update:list --branch production --limit 5` shows the update group ids.
2. `npx eas-cli update:rollback <GROUP_ID> --message "Roll back: <why>"` (the group must be the latest on its branch and runtime version). Phones pick it up on their next launch.
3. Fix forward on a branch, try it on preview, publish again.

A rollback cannot recall an update from phones that already applied it and never reopen the app.

## Notes

- **The public Supabase settings come from `eas.json`.** The app reads `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` at build time, and store builds get them from the `env` block of their profile in `app/eas.json`. `eas update` does not read that block, so `npm run update:production` passes the production profile's `env` to the checks and to the publish itself, and `scripts/updatesConfig.test.js` fails if the block is emptied. Both values are public (the key is the publishable one). Anything secret must never go in an `EXPO_PUBLIC_*` variable.
- Check Apple's and Google's current rules on over-the-air updates before relying on them for anything beyond fixing JavaScript and assets.
- `app.json` lists only `ios` and `android` under `platforms`. `eas update` exports every listed platform, and this app's web export does not build (the SQLite web worker), so without that line a publish fails before sending anything.
