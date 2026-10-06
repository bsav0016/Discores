import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { listStatRounds } from '@/db/local';
import { formatRelative } from '@/domain/scoring';
import { computeStats, type CourseStats, type Outcomes, type StatRound } from '@/domain/stats';
import { useAuth } from '@/lib/auth';
import { Badge, Card, colors, radius, s, SectionTitle } from '@/lib/ui';

const OUTCOME_KEYS: (keyof Outcomes)[] = ['eagle', 'birdie', 'par', 'bogey', 'double'];
const OUTCOME_COLORS: Record<keyof Outcomes, string> = {
  eagle: '#0f6b3f', birdie: '#1b7f4b', par: '#a9c9b4', bogey: '#f2a93b', double: '#b3261e',
};
const OUTCOME_LABELS: Record<keyof Outcomes, string> = {
  eagle: 'Eagle or better', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double or worse',
};
// Under par is good in disc golf, as in golf.
const relColor = (n: number) => (n < 0 ? colors.brandDark : n > 0 ? colors.danger : colors.ink);
const avgLabel = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

export default function Stats() {
  const { ownerId, syncTick } = useAuth();
  const [rounds, setRounds] = useState<StatRound[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      listStatRounds(ownerId).then(setRounds);
    }, [ownerId, syncTick]),
  );
  const stats = useMemo(() => (rounds ? computeStats(rounds) : null), [rounds]);

  if (!stats) return <View style={s.screen} />;

  if (stats.rounds === 0) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.pad}>
        <View style={{ alignItems: 'center', marginTop: 48, gap: 8 }}>
          <Ionicons name="stats-chart-outline" size={56} color={colors.line} />
          <Text style={s.h2}>No stats yet</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Finish a round and your scores, best rounds and trouble holes show up here.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const totalHoles = OUTCOME_KEYS.reduce((a, k) => a + stats.outcomes[k], 0);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Tile label="Rounds" value={String(stats.rounds)} />
        <Tile label="Holes" value={String(stats.holes)} />
        <Tile label="Best round"
          value={stats.best ? formatRelative(stats.best.relative) : '–'}
          color={stats.best ? relColor(stats.best.relative) : undefined}
          note={stats.best ? stats.best.courseName : 'Finish all holes'} />
      </View>

      <SectionTitle>How your holes go</SectionTitle>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', height: 14, borderRadius: radius.pill, overflow: 'hidden', backgroundColor: colors.line }}>
          {OUTCOME_KEYS.map((k) =>
            stats.outcomes[k] > 0 ? <View key={k} style={{ flex: stats.outcomes[k], backgroundColor: OUTCOME_COLORS[k] }} /> : null)}
        </View>
        {OUTCOME_KEYS.map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: OUTCOME_COLORS[k] }} />
            <Text style={[s.body, { flex: 1 }]}>{OUTCOME_LABELS[k]}</Text>
            <Text style={s.muted}>
              {stats.outcomes[k]} · {Math.round((stats.outcomes[k] / totalHoles) * 100)}%
            </Text>
          </View>
        ))}
      </Card>

      <SectionTitle>Courses</SectionTitle>
      {stats.courses.map((c) => (
        <CourseCard key={c.layoutId} c={c} open={open === c.layoutId}
          onPress={() => setOpen(open === c.layoutId ? null : c.layoutId)} />
      ))}
    </ScrollView>
  );
}

function Tile({ label, value, note, color }: { label: string; value: string; note?: string; color?: string }) {
  return (
    <Card style={{ flex: 1, alignItems: 'center', gap: 2, paddingHorizontal: 8 }}>
      <Text style={s.label}>{label.toUpperCase()}</Text>
      <Text style={{ fontSize: 28, fontWeight: '800', color: color ?? colors.ink }}>{value}</Text>
      {note ? <Text style={[s.muted, { fontSize: 11, textAlign: 'center' }]} numberOfLines={1}>{note}</Text> : null}
    </Card>
  );
}

function CourseCard({ c, open, onPress }: { c: CourseStats; open: boolean; onPress: () => void }) {
  const recent = c.rounds.slice(-10);
  const scale = Math.max(3, ...recent.map((r) => Math.abs(r.relative)));
  return (
    <Card onPress={onPress} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{c.courseName}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </View>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Badge label={`${c.rounds.length} full round${c.rounds.length === 1 ? '' : 's'}`} />
        {c.bestRelative !== null && <Badge label={`Best ${formatRelative(c.bestRelative)} (${c.bestTotal})`} tone="good" />}
        {c.averageRelative !== null && <Badge label={`Avg ${avgLabel(c.averageRelative)}`} />}
      </View>
      {open && (
        <View style={{ gap: 10, marginTop: 4 }}>
          {recent.length > 0 && (
            <>
              <Text style={s.label}>LAST {recent.length} ROUND{recent.length === 1 ? '' : 'S'} VS PAR</Text>
              <View style={{ flexDirection: 'row', height: 90, gap: 4 }}>
                <View style={{ position: 'absolute', left: 0, right: 0, top: 45, height: 1, backgroundColor: colors.line }} />
                {recent.map((r) => {
                  const h = Math.max(3, (Math.abs(r.relative) / scale) * 42);
                  return (
                    <View key={r.id} style={{ flex: 1, height: 90, alignItems: 'center' }}>
                      <View style={{ height: 45, justifyContent: 'flex-end' }}>
                        {r.relative > 0 && <View style={{ height: h, width: 14, backgroundColor: colors.danger, borderRadius: 3 }} />}
                      </View>
                      <View style={{ height: 45 }}>
                        {r.relative <= 0 && <View style={{ height: h, width: 14, backgroundColor: colors.brand, borderRadius: 3 }} />}
                      </View>
                    </View>
                  );
                })}
              </View>
              <Text style={[s.muted, { fontSize: 12 }]}>Bars above the line are over par, below are under. Oldest on the left.</Text>
            </>
          )}
          <Text style={s.label}>AVERAGE PER HOLE VS PAR</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {c.holeAverages.map((a, i) => (
              <View key={i} style={{
                width: 48, paddingVertical: 6, alignItems: 'center', borderRadius: radius.sm,
                backgroundColor: a === null ? colors.bg : a > 0.5 ? colors.dangerSoft : a < 0 ? colors.brandSoft : colors.bg,
              }}>
                <Text style={[s.muted, { fontSize: 11 }]}>{i + 1}</Text>
                <Text style={{ fontWeight: '800', color: a === null ? colors.muted : relColor(a) }}>
                  {a === null ? '–' : avgLabel(a)}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[s.muted, { fontSize: 12 }]}>Red holes cost you the most strokes.</Text>
        </View>
      )}
    </Card>
  );
}
