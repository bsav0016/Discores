import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { listFriends, listTogetherRounds } from '@/db/local';
import { groupBoards, headToHead, type CourseBoard, type FriendRecord } from '@/domain/together';
import { onlyCurrentFriends } from '@/domain/togetherFormat';
import { useAuth } from '@/lib/auth';

export type Together = {
  /** A record for each current friend you have shared a finished round with. */
  records: FriendRecord[];
  /** Best rounds per course among you and your current friends. */
  boards: CourseBoard[];
};

/** Reads the finished rounds on this phone and works out the group comparisons; null until loaded. */
export function useTogether(): Together | null {
  const { ownerId, syncTick, guest } = useAuth();
  const [together, setTogether] = useState<Together | null>(null);

  useFocusEffect(
    useCallback(() => {
      let stale = false;
      if (guest) {
        setTogether({ records: [], boards: [] });
        return;
      }
      Promise.all([listTogetherRounds(ownerId), listFriends()]).then(([rounds, friends]) => {
        if (stale) return;
        const ids = new Set(friends.filter((f) => f.kind === 'friend').map((f) => f.user_id));
        setTogether({
          records: headToHead(rounds, ownerId).filter((r) => ids.has(r.userId)),
          boards: onlyCurrentFriends(groupBoards(rounds, ownerId), ids),
        });
      }).catch(() => !stale && setTogether({ records: [], boards: [] }));
      return () => {
        stale = true;
      };
    }, [ownerId, syncTick, guest]),
  );
  return together;
}
