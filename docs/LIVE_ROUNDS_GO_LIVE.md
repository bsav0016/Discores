# Live rounds: go-live and two-phone test

Live rounds let a registered friend open a round on their own phone while it is being played and enter their own scores. The owner's phone can still score everyone. See the Live rounds section of the README for how it works.

## 1. Server (already done in production unless a box is unchecked)

- [x] Migration 0028 (`list_live_rounds`, `sync_my_seat`), applied 2026-11-15.
- [x] Migration 0029 (`round_live` push event), applied 2026-11-15.
- [x] `send-push` redeployed with the new message text.
- [ ] Push itself still needs the rest of [PUSH_GO_LIVE.md](PUSH_GO_LIVE.md) (secrets, schedule, a build with `expo-notifications`). Until then nobody receives the "added you to a round" message, and a friend finds a live round by opening the app: it sits at the top of History and shows a Live badge.

## 2. The app

Live rounds are JavaScript only, but installed 1.0.1 builds have no update module, so this ships with the next store build (1.1.0, see [over-the-air-updates.md](over-the-air-updates.md)). Old app versions keep working and simply never see live rounds.

1. Merge the version PR, then build and submit both stores (`eas build --platform ios --profile production`, `--platform android ...`).
2. Merge the policy PR with the release, so the privacy policy and the app go out together.
3. Add the live-rounds line to the 1.1.0 release notes (see `docs/store/listing.md`).
4. App Store Connect App Privacy and Play Data safety: no new kinds of data are collected, so nothing changes for this feature.

## 3. Two-phone test

You need two phones (or one phone and one simulator), each signed in to a different account, the two accounts already friends, and a build that contains the feature (a development build, TestFlight or internal-test build).

Call the phones **A** (owner) and **B** (friend).

1. **A** starts a round on any course and adds **B** as a player. Score hole 1 for both. Wait for the "waiting to sync" label to clear, or pull down on History.
2. **B** opens the app and pulls down on History. Expected: at the top, "A added you to a round", and the round with a **Live** badge. Tap it.
3. On **B** the round screen shows the "Live round" banner. B's own row has + and − buttons; A's row shows its score but its buttons are disabled. A has no Finish button.
4. **B** enters hole 1 for itself, then hole 2. Within about 30 seconds (or after pulling down on History) **A** should see B's scores appear on A's round screen.
5. **A** enters hole 2 for A, and hole 3 for both A and B (the owner may enter any seat). **B**'s screen should show A's scores within 30 seconds.
6. **Conflict:** with both phones online, change B's hole 3 on A and B within a few seconds of each other. Both phones should settle on the same value, the newer entry.
7. **Offline:** put **B** in airplane mode, enter hole 4, then turn it back on. B's score should reach A after the next sync.
8. **A** finishes the round. On **B** the round shows as finished and read-only. After a sync it moves out of the Live area into History as a finished shared round.
9. Check **B** has nothing to confirm: no "round to confirm" card, because B entered its own scores.
10. **Friend who never joins:** repeat with a third player **C** who never opens the app. After A finishes, C should get the normal "round to confirm" card.
11. **Safety:** B blocks A (or removes A as a friend) mid-round. B should lose the round at the next sync and B's next score is not accepted.

Push (once push is live): at step 1, B should get "A added you to a round. Open it to enter your scores." Tapping it opens History.

## 4. If something goes wrong

Live rounds add no tables and do not change `sync_round`, so rounds keep working on one phone whatever happens. To switch the feature off on the server without a new build, revoke the two functions:

```sql
revoke execute on function public.list_live_rounds() from authenticated;
revoke execute on function public.sync_my_seat(uuid, jsonb) from authenticated;
```

The app treats a refused call as "nothing live", and a friend's unsent scores simply stay on their phone. Undo with the matching `grant execute ... to authenticated`.
