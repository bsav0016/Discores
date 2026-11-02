// Suggesting a round's pars to its course. A player who edits the holes or pars of a round on a course that is not
// verified yet (round.pars_edited) has the pars suggested once, after the round is finished. When a second player
// suggests identical pars the server verifies the course (suggest_layout, migration 0023).
//
// Best effort: nothing here may get in the way of scoring or syncing. A suggestion that cannot be sent (offline,
// server error) stays pending and is tried again on the next sync; one the server will never accept is dropped.

export type PendingSuggestion = { roundId: string; layoutId: string; pars: number[]; finishedAt: string };

export type SuggestResult = { result: string | null; error: { message?: string } | null };

export type SuggestDeps = {
  /** The user's own finished rounds whose pars were edited and not suggested yet, oldest first. */
  listPending: () => Promise<PendingSuggestion[]>;
  /** Stops a round from being suggested again. */
  clear: (roundId: string) => Promise<void>;
  /** True when the phone already knows the course's pars are confirmed. */
  isVerified: (layoutId: string) => Promise<boolean>;
  /** Calls suggest_layout(). */
  suggest: (layoutId: string, pars: number[]) => Promise<SuggestResult>;
  /** Called when the server verified a course, so the cached copy (and its label) can be refreshed. */
  onVerified: () => Promise<void>;
};

export type SuggestSummary = { sent: number; verified: number; dropped: number; kept: number };

// Answers that mean "this will never work, stop trying" rather than "try again later".
const FINAL_ANSWERS = new Set(['ok', 'verified', 'already_verified', 'not_found']);
const REJECTED_FOR_GOOD = /1 to 36 holes|Par must be between/i;
const LIMIT_REACHED = /Too many suggestions/i;

export async function sendPendingSuggestions(deps: SuggestDeps): Promise<SuggestSummary> {
  const summary: SuggestSummary = { sent: 0, verified: 0, dropped: 0, kept: 0 };
  const pending = await deps.listPending();
  // A player has one vote per course: send the latest edited round of each course, and settle the older ones with it.
  const latest = new Map<string, PendingSuggestion>();
  for (const p of [...pending].sort((a, b) => Date.parse(a.finishedAt) - Date.parse(b.finishedAt))) latest.set(p.layoutId, p);
  const byLayout = new Map<string, PendingSuggestion[]>();
  for (const p of pending) byLayout.set(p.layoutId, [...(byLayout.get(p.layoutId) ?? []), p]);

  let anyVerified = false;
  for (const [layoutId, chosen] of latest) {
    const rounds = byLayout.get(layoutId) ?? [];
    const settle = async () => { for (const r of rounds) await deps.clear(r.roundId); };

    if (await deps.isVerified(layoutId)) {
      await settle();
      summary.dropped += rounds.length;
      continue;
    }
    let answer: SuggestResult;
    try {
      answer = await deps.suggest(layoutId, chosen.pars);
    } catch {
      summary.kept += rounds.length;
      break; // offline or similar: try everything again next time
    }
    if (answer.error) {
      const message = answer.error.message ?? '';
      if (REJECTED_FOR_GOOD.test(message)) {
        await settle();
        summary.dropped += rounds.length;
        continue;
      }
      summary.kept += rounds.length;
      if (LIMIT_REACHED.test(message)) break; // the daily limit applies to every course; wait for tomorrow
      continue;
    }
    if (answer.result !== null && FINAL_ANSWERS.has(answer.result)) {
      await settle();
      summary.sent += 1;
      if (answer.result === 'verified') {
        summary.verified += 1;
        anyVerified = true;
      }
    } else {
      summary.kept += rounds.length;
    }
  }
  if (anyVerified) await deps.onVerified();
  return summary;
}
