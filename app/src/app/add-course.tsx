import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ParGrid } from '@/lib/ParGrid';
import { Button, colors, Field, s, SectionTitle } from '@/lib/ui';
import { addCourse } from '@/sync/courses';

const COUNTS = [9, 12, 18, 24];

export default function AddCourse() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [count, setCount] = useState(18);
  const [pars, setPars] = useState<number[]>(Array(18).fill(3));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function changeCount(n: number) {
    setCount(n);
    setPars((p) => Array.from({ length: n }, (_, i) => p[i] ?? 3));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const r = await addCourse(name, area, pars);
    setBusy(false);
    if (typeof r === 'string') setError(r.includes('Network') || r.includes('fetch') ? "Can't reach the server. Check your connection and try again." : r);
    else router.back();
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        Add a course that's missing. We only ask for a name and a city or area, not an exact address.
      </Text>
      <Field label="Course name" value={name} onChangeText={setName} maxLength={80} />
      <Field label="City / area (optional)" value={area} onChangeText={setArea} maxLength={80} placeholder="e.g. Austin, TX" />

      <SectionTitle>Number of holes</SectionTitle>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {COUNTS.map((n) => (
          <Pressable key={n} onPress={() => changeCount(n)}
            style={[s.chip, count === n && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
            <Text style={{ color: count === n ? '#fff' : colors.ink, fontWeight: '700' }}>{n}</Text>
          </Pressable>
        ))}
      </View>

      <SectionTitle>Par per hole</SectionTitle>
      <ParGrid pars={pars} onChange={setPars} />

      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save course'} onPress={save} disabled={busy || name.trim().length < 2} />
    </ScrollView>
  );
}
