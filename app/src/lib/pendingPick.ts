// A hand-off between screens: a course chosen on the "Add a course" screen (an existing course the player recognised,
// or the one they just added) is picked for the new round when they land back on it. Held in memory only.

let pending: string | null = null;

export function setPendingPick(layoutId: string | null) {
  pending = layoutId;
}

/** Returns the layout id waiting to be picked, once; the next call returns null. */
export function takePendingPick(): string | null {
  const id = pending;
  pending = null;
  return id;
}
