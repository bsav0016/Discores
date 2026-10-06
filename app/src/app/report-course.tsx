import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Chip, Field, s, SectionTitle } from '@/lib/ui';
import { CORRECTION_KINDS, reportCourseIssue, type CourseKind } from '@/sync/courses';

export default function ReportCourse() {
  const { id, name } = useLocalSearchParams<{ id: string; name: string }>();
  const router = useRouter();
  const [kind, setKind] = useState<CourseKind>('holes');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const err = await reportCourseIssue(id, kind, note);
    setBusy(false);
    if (err) setError(err.includes('check') ? 'Please add a few more words.' : err);
    else setSent(true);
  }

  if (sent) {
    return (
      <View style={[s.screen, s.pad, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={s.h2}>Thanks for the report</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>We'll review it and update the course.</Text>
        <Button title="Done" onPress={() => router.back()} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.h2}>{name}</Text>
      <SectionTitle>What's wrong?</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CORRECTION_KINDS.map((k) => (
          <Chip key={k.value} label={k.label} selected={kind === k.value} onPress={() => setKind(k.value)} />
        ))}
      </View>
      <Field label="Details" value={note} onChangeText={setNote} maxLength={500} multiline
        style={{ minHeight: 110, textAlignVertical: 'top' }} placeholder="e.g. Hole 7 is par 4, not 3" />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Sending…' : 'Send report'} onPress={send} disabled={busy || note.trim().length < 3} />
    </ScrollView>
  );
}
