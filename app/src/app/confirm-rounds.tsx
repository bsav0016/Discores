import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { formatRelative, relativeToPar, totalStrokes, type ScoreMap } from '@/domain/scoring';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, colors, radius, s } from '@/lib/ui';
import { listPendingRounds, respondToRound, type PendingRound } from '@/sync/social';

/** Rounds a friend scored for you. Nothing is added to your history or stats until you confirm it. */
export default function ConfirmRounds() {
  const { refreshPending, sync } = useAuth();
  const [rounds, setRounds] = useState<PendingRound[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listPendingRounds();
    setFailed(r === null);
    if (r) setRounds(r);
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function answer(r: PendingRound, accept: boolean) {
    setBusy(r.round_id);
    const err = await respondToRound(r.round_id, accept);
    setBusy(null);
    if (err) {
      Alert.alert("That didn't work", err);
      return;
    }
    setRounds((rs) => rs?.filter((x) => x.round_id !== r.round_id) ?? rs);
    // A confirmed round joins the history and stats on the next pull.
    if (accept) await sync();
    else await refreshPending();
  }

  function decline(r: PendingRound) {
    Alert.alert(
      "This isn't my round?",
      `It won't be added to your history or stats. ${r.scorer} will see that you declined, and your name stays on their round as plain text with no link to your account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Decline', style: 'destructive', onPress: () => void answer(r, false) },
      ],
    );
  }

  if (!rounds) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }]}>
        {failed ? (
          <>
            <Text style={s.error}>Couldn't load. Check your connection.</Text>
            <Button title="Try again" variant="soft" onPress={load} />
          </>
        ) : <ActivityIndicator color={colors.brand} />}
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      {rounds.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 48, gap: 8 }}>
          <Ionicons name="checkmark-circle-outline" size={56} color={colors.line} />
          <Text style={s.h2}>Nothing to confirm</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            When a friend enters your scores in a round, it shows up here first.
          </Text>
        </View>
      ) : (
        <Text style={s.muted}>
          A friend scored these rounds for you. Check the scores, then confirm to add them to your history and stats.
        </Text>
      )}
      {rounds.map((r) => {
        const scores: ScoreMap = Object.fromEntries(r.scores.map((x) => [x.hole_number, x.strokes]));
        const rel = relativeToPar(r.pars, scores);
        return (
          <Card key={r.round_id} style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[s.h2, { flex: 1 }]} numberOfLines={2}>{r.course_name}</Text>
              <Badge label={`from ${r.scorer}`} tone="warn" />
            </View>
            <Text style={s.muted}>{new Date(r.finished_at).toLocaleDateString()} · {r.hole_count} holes</Text>
            <Text style={s.body}>
              Your score: <Text style={{ fontWeight: '800' }}>{totalStrokes(scores)}</Text>
              {' '}({formatRelative(rel)}){r.scores.length < r.hole_count ? ` · ${r.scores.length} of ${r.hole_count} holes` : ''}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {r.pars.map((par, i) => {
                const strokes = scores[i + 1];
                const d = strokes === undefined ? null : strokes - par;
                return (
                  <View key={i} style={{
                    width: 40, paddingVertical: 4, alignItems: 'center', borderRadius: radius.sm,
                    backgroundColor: d === null ? colors.bg : d < 0 ? colors.brandSoft : d > 0 ? colors.dangerSoft : colors.bg,
                  }}>
                    <Text style={[s.muted, { fontSize: 10 }]}>{i + 1}</Text>
                    <Text style={{ fontWeight: '800', color: d === null ? colors.muted : d < 0 ? colors.brandDark : d > 0 ? colors.danger : colors.ink }}>
                      {strokes ?? '–'}
                    </Text>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
              <Button title="Not mine" variant="ghost" style={{ flex: 1, marginTop: 0 }} disabled={busy === r.round_id}
                onPress={() => decline(r)} />
              <Button title={busy === r.round_id ? 'Saving…' : 'Confirm'} style={{ flex: 1, marginTop: 0 }}
                disabled={busy === r.round_id} onPress={() => answer(r, true)} />
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}
