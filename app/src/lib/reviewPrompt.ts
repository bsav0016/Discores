import * as SecureStore from 'expo-secure-store';
import * as StoreReview from 'expo-store-review';
import { listStatRounds } from '@/db/local';
import { shouldAskForReview } from '@/domain/reviewPrompt';

// When the store review prompt was last requested. Only a date, kept on this phone.
const KEY = 'discores.reviewAskedAt';

async function readLastAsked(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(KEY);
  } catch {
    return null;
  }
}

/**
 * After the player finishes a round, ask the store for its review prompt if it is a good moment (see
 * shouldAskForReview). The store decides whether the prompt actually appears; it limits how often it does.
 * Never throws: a review prompt must not get in the way of finishing a round.
 */
export async function maybeAskForReview(ownerId: string, justFinishedId: string): Promise<void> {
  try {
    if (__DEV__) return;
    const now = new Date();
    const ask = shouldAskForReview({
      rounds: await listStatRounds(ownerId),
      justFinishedId,
      lastAskedAt: await readLastAsked(),
      now,
    });
    if (!ask) return;
    if (!(await StoreReview.isAvailableAsync()) || !(await StoreReview.hasAction())) return;
    // Record the ask first, so a crash or a slow prompt cannot lead to asking again straight away.
    await SecureStore.setItemAsync(KEY, now.toISOString());
    await StoreReview.requestReview();
  } catch {
    // Ignore: nothing here is worth interrupting the player for.
  }
}
