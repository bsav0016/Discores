// Who may change which scores on the round screen. Pure, so the rules are tested rather than left to the screen.

export type SeatRound = { live: boolean; shared: boolean; finished: boolean };

/**
 * Whether the signed-in user can change a seat's score.
 *  - A finished round is read-only for everyone.
 *  - In a live round someone else owns, you change your own seat and nobody else's.
 *  - A round shared with you after it finished is read-only (it is covered by "finished" above).
 *  - Your own round: you keep score for every seat, as you always did. Friends' own entries win only where they
 *    are newer (the sync merge decides), so scoring a friend's seat here is still allowed.
 */
export function canEditSeat(round: SeatRound, seatUserId: string | null, me: string | null): boolean {
  if (round.finished) return false;
  if (round.live) return !!me && seatUserId === me;
  return !round.shared;
}

/** Whether the screen should keep refreshing from the server while it is open: a round in progress with other people. */
export function isLiveRound(
  round: { live: boolean; shared: boolean; finished: boolean; ownerId: string },
  seatUserIds: (string | null)[],
): boolean {
  if (round.finished) return false;
  if (round.live) return true;
  return !round.shared && seatUserIds.some((id) => id !== null && id !== round.ownerId);
}

/** The line shown above the players of a live round. */
export function liveBanner(
  round: { live: boolean; ownerName: string | null },
  hasFriendSeats: boolean,
): { title: string; detail: string } | null {
  if (round.live) {
    return {
      title: 'Live round',
      detail: `${round.ownerName ?? 'Someone'} is keeping score. Enter your own strokes; everyone's scores update every 30 seconds.`,
    };
  }
  if (hasFriendSeats) {
    return {
      title: 'Friends can score along',
      detail: 'A friend in this round can open it on their phone and enter their own strokes. You can still enter any score yourself; the newer one wins.',
    };
  }
  return null;
}
