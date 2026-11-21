import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { formatRelative } from '@/domain/scoring';
import type { CourseBoard, FriendRecord } from '@/domain/together';
import { gapLabel, recordLabel, togetherLabel } from '@/domain/togetherFormat';
import { Badge, Card, colors, s, SectionTitle } from '@/lib/ui';

// Where you stand against the people you play with. Everything here comes from finished rounds on this phone.

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
// Fewer strokes than the other person is good, as with par.
const gapColor = (diff: number) => (diff < 0 ? colors.brandDark : diff > 0 ? colors.danger : colors.ink);

/** The "Together" card on a friend's page: your record against them and the last rounds you both finished. */
export function TogetherCard({ name, record }: { name: string; record: FriendRecord | undefined }) {
  if (!record) {
    return (
      <Card style={{ gap: 6 }}>
        <Text style={s.label}>TOGETHER</Text>
        <Text style={s.body}>No finished rounds with {name} yet.</Text>
        <Text style={[s.muted, { fontSize: 12 }]}>
          Play a round together and your record shows up here. It counts rounds on this phone where you both scored every hole.
        </Text>
      </Card>
    );
  }
  const last = record.rounds.slice(0, 5);
  return (
    <Card style={{ gap: 10 }}>
      <Text style={s.label}>TOGETHER</Text>
      <Text style={s.body}>{togetherLabel(record.roundsTogether)}</Text>
      {record.compared === 0 ? (
        <Text style={[s.muted, { fontSize: 12 }]}>
          Neither of you has finished every hole of a round together yet, so there is no record to show.
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge label={`Record ${recordLabel(record)}`} tone="good" />
            {record.averageDiff !== null && <Badge label={`On average ${gapLabel(record.averageDiff)}`} />}
            {record.bestRound && <Badge label={`Best ${gapLabel(record.bestRound.diff)} at ${record.bestRound.courseName}`} />}
          </View>
          <Text style={[s.muted, { fontSize: 12 }]}>Record is your wins, ties and losses, by total strokes. Fewer strokes wins.</Text>
          <Text style={s.label}>LAST {last.length} ROUND{last.length === 1 ? '' : 'S'}</Text>
          {last.map((r) => (
            <View key={r.roundId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{r.courseName}</Text>
              <Text style={s.muted}>{dateLabel(r.startedAt)}</Text>
              <Text style={{ fontWeight: '800', color: gapColor(r.diff), minWidth: 72, textAlign: 'right' }}>
                {r.myTotal}–{r.theirTotal}
              </Text>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

/** "Your group" on the Stats screen: a line for each friend you have played with, opening their page. */
export function GroupSection({ records }: { records: FriendRecord[] }) {
  const router = useRouter();
  if (records.length === 0) return null;
  return (
    <>
      <SectionTitle>Your group</SectionTitle>
      {records.map((f) => (
        <Card
          key={f.userId}
          onPress={() => router.push({ pathname: '/person/[id]', params: { id: f.userId, name: f.name, kind: 'friend' } })}
          style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{f.name}</Text>
            <Text style={s.muted}>{togetherLabel(f.roundsTogether)}</Text>
          </View>
          {f.compared > 0 ? (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Badge label={`Record ${recordLabel(f)}`} tone="good" />
              {f.averageDiff !== null && <Badge label={`On average ${gapLabel(f.averageDiff)}`} />}
            </View>
          ) : (
            <Text style={[s.muted, { fontSize: 12 }]}>No full rounds to compare yet.</Text>
          )}
        </Card>
      ))}
      <Text style={[s.muted, { fontSize: 12 }]}>
        From finished rounds on this phone where you both scored every hole. Only you and your friends see this.
      </Text>
    </>
  );
}

/** The group's best rounds on one course, shown inside that course's stats card. */
export function CourseBoardView({ board }: { board: CourseBoard }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>YOUR GROUP'S BEST ROUNDS</Text>
      {board.entries.map((e, i) => (
        <View key={e.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[s.muted, { width: 18 }]}>{i + 1}</Text>
          <Text style={[e.isMe ? { fontWeight: '800', color: colors.ink } : s.body, { flex: 1 }]} numberOfLines={1}>{e.name}</Text>
          <Text style={s.muted}>{formatRelative(e.relative)}</Text>
          <Text style={{ fontWeight: '800', color: colors.ink, minWidth: 28, textAlign: 'right' }}>{e.total}</Text>
        </View>
      ))}
    </View>
  );
}
