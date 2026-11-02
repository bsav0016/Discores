import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { upsertLayout } from '@/db/local';
import { ParGrid } from '@/lib/ParGrid';
import { setPendingPick } from '@/lib/pendingPick';
import { Badge, Button, Card, colors, Field, s, SectionTitle } from '@/lib/ui';
import { addCourse, similarCourses, type SimilarCourse } from '@/sync/courses';

const COUNTS = [9, 12, 18, 24];

export default function AddCourse() {
  const router = useRouter();
  // Opened from an empty search with what the player typed, so they do not type it again.
  const { name: nameParam } = useLocalSearchParams<{ name?: string }>();
  const [name, setName] = useState(typeof nameParam === 'string' ? nameParam.slice(0, 80) : '');
  const [area, setArea] = useState('');
  const [count, setCount] = useState(18);
  const [pars, setPars] = useState<number[]>(Array(18).fill(3));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarCourse[]>([]);

  // "Is it one of these?": courses with a similar name, checked as the name is typed. Errors just show nothing.
  const typed = name.trim();
  useEffect(() => {
    if (typed.length < 3) {
      setSimilar([]);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      similarCourses(typed, area).then((found) => !stale && setSimilar(found)).catch(() => {});
    }, 400);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [typed, area]);

  function changeCount(n: number) {
    setCount(n);
    setPars((p) => Array.from({ length: n }, (_, i) => p[i] ?? 3));
  }

  async function useExisting(course: SimilarCourse) {
    const { similarity: _similarity, ...layout } = course;
    await upsertLayout(layout); // cached, so the round works offline
    setPendingPick(layout.layout_id);
    router.back();
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await addCourse(name, area, pars);
    setBusy(false);
    if (typeof r === 'string') {
      setError(r.includes('Network') || r.includes('fetch') ? "Can't reach the server. Check your connection and try again." : r);
    } else {
      setPendingPick(r.layout_id); // the new course is picked for the round when we get back
      router.back();
    }
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        Add a course that's missing. We only ask for a name and a city or area, not an exact address.
      </Text>
      <Field label="Course name" value={name} onChangeText={setName} maxLength={80} />
      <Field label="City / area (optional)" value={area} onChangeText={setArea} maxLength={80} placeholder="e.g. Austin, TX" />

      {similar.length > 0 && (
        <View style={{ gap: 8 }}>
          <SectionTitle>Already on Discores?</SectionTitle>
          <Text style={s.muted}>If your course is one of these, use it instead so everyone plays the same one.</Text>
          {similar.map((c) => (
            <Card key={c.layout_id} style={{ gap: 6 }}>
              <Text style={[s.h2, { fontSize: 17 }]} numberOfLines={2}>{c.course_name}</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge label={`${c.hole_count} holes`} />
                {!c.verified && <Badge label="Pars not confirmed" tone="warn" />}
                {c.area ? <Text style={s.muted}>{c.area}</Text> : null}
              </View>
              <Button title="Use this course" variant="soft" onPress={() => useExisting(c)} />
            </Card>
          ))}
          <Text style={s.muted}>Not in the list? Keep going to add it.</Text>
        </View>
      )}

      <SectionTitle>Number of holes</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {COUNTS.map((n) => (
          <Pressable key={n} onPress={() => changeCount(n)} accessibilityRole="button" accessibilityLabel={`${n} holes`}
            accessibilityState={{ selected: count === n }}
            style={[s.chip, count === n && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
            <Text style={{ color: count === n ? '#fff' : colors.ink, fontWeight: '700' }}>{n}</Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle>Par per hole</SectionTitle>
      <Text style={s.muted}>
        Set what you know. The pars count as your suggestion for the course: when another player agrees with them, the course becomes confirmed.
      </Text>
      <ParGrid pars={pars} onChange={setPars} />

      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save course'} onPress={save} disabled={busy || name.trim().length < 2} />
    </ScrollView>
  );
}
