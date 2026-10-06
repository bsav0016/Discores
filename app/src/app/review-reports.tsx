import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { ParGrid } from '@/lib/ParGrid';
import { Badge, Button, Card, Chip, colors, Field, s } from '@/lib/ui';
import {
  listReports, listUserReports, resolveReport, resolveUserReport, type CourseReport, type UserReport,
} from '@/sync/admin';
import { CORRECTION_KINDS } from '@/sync/courses';
import { REPORT_REASONS } from '@/sync/social';

const kindLabel = (k: string) => CORRECTION_KINDS.find((c) => c.value === k)?.label ?? k;
const sameArray = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export default function ReviewReports() {
  const [tab, setTab] = useState<'courses' | 'people'>('courses');
  return (
    <View style={s.screen}>
      <View style={{ flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 0 }}>
        <Chip label="Courses" selected={tab === 'courses'} onPress={() => setTab('courses')} />
        <Chip label="People" selected={tab === 'people'} onPress={() => setTab('people')} />
      </View>
      {tab === 'courses' ? <CourseReports /> : <PeopleReports />}
    </View>
  );
}

const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;

function PeopleReports() {
  const [reports, setReports] = useState<UserReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listUserReports();
    if (typeof r === 'string') setLoadError(r);
    else {
      setLoadError(null);
      setReports(r);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  async function resolve(r: UserReport, status: 'actioned' | 'dismissed', opts = {}) {
    const err = await resolveUserReport(r.id, status, opts);
    if (err) Alert.alert("Couldn't close the report", err);
    void load();
  }

  if (reports === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        {loadError ? (
          <>
            <Text style={s.error}>{loadError}</Text>
            <Button title="Try again" variant="soft" onPress={load} />
          </>
        ) : (
          <ActivityIndicator color={colors.brand} />
        )}
      </View>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={s.pad}>
      {reports.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 48, gap: 8 }}>
          <Ionicons name="checkmark-circle-outline" size={56} color={colors.line} />
          <Text style={s.h2}>All caught up</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>No reports about people are waiting.</Text>
        </View>
      ) : (
        <Text style={s.muted}>{reports.length} waiting, oldest first</Text>
      )}
      {reports.map((r) => (
        <Card key={r.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{r.display_name}</Text>
            <Badge label={reasonLabel(r.reason)} tone="warn" />
          </View>
          <Text style={s.muted}>
            {[r.username ? `@${r.username}` : 'no username', new Date(r.created_at).toLocaleDateString(),
              r.other_pending > 0 ? `${r.other_pending} other report${r.other_pending === 1 ? '' : 's'}` : null]
              .filter(Boolean).join(' · ')}
          </Text>
          {r.note ? <Text style={[s.body, { marginTop: 6 }]}>{r.note}</Text> : null}
          <View style={{ gap: 8, marginTop: 8 }}>
            {r.username && (
              <Button title="Remove username" variant="soft" style={{ marginTop: 0 }}
                onPress={() => resolve(r, 'actioned', { clearUsername: true })} />
            )}
            <Button title="Reset display name" variant="soft" style={{ marginTop: 0 }}
              onPress={() => resolve(r, 'actioned', { resetName: true })} />
            <Button title="Dismiss" variant="ghost" style={{ marginTop: 0 }} onPress={() => resolve(r, 'dismissed')} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

function CourseReports() {
  const [reports, setReports] = useState<CourseReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listReports();
    if (typeof r === 'string') setLoadError(r);
    else {
      setLoadError(null);
      setReports(r);
    }
  }, []);
  useFocusEffect(useCallback(() => void load(), [load]));

  // Drop the closed report right away, then refetch: another report on the same course now shows its new pars,
  // so a reviewer can't overwrite a fix with stale values.
  const removeLocal = (id: string) => {
    setReports((rs) => rs?.filter((r) => r.id !== id) ?? rs);
    setEditing(null);
    void load();
  };

  function dismiss(r: CourseReport) {
    Alert.alert('Dismiss this report?', 'The course stays as it is and the report is closed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Dismiss',
        style: 'destructive',
        onPress: async () => {
          const err = await resolveReport(r.id, 'rejected');
          if (err) Alert.alert("Couldn't dismiss", err);
          else removeLocal(r.id);
        },
      },
    ]);
  }

  if (reports === null) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }]}>
        {loadError ? (
          <>
            <Text style={s.error}>{loadError}</Text>
            <Button title="Try again" variant="soft" onPress={load} />
          </>
        ) : (
          <ActivityIndicator color={colors.brand} />
        )}
      </View>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad}>
      {reports.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 48, gap: 8 }}>
          <Ionicons name="checkmark-circle-outline" size={56} color={colors.line} />
          <Text style={s.h2}>All caught up</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>No course reports are waiting for review.</Text>
        </View>
      ) : (
        <Text style={s.muted}>{reports.length} waiting, oldest first</Text>
      )}
      {reports.map((r) =>
        editing === r.id ? (
          // Keyed by the course data it was opened with: if a refetch brings newer values (another reviewer or
          // report changed the course), the editor restarts from them instead of sending stale ones back.
          <Editor key={`${r.id}|${r.course_name}|${r.area}|${r.pars?.join('')}`} report={r}
            onCancel={() => setEditing(null)} onDone={() => removeLocal(r.id)} />
        ) : (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={[s.h2, { flex: 1 }]}>{r.course_name}</Text>
              <Badge label={kindLabel(r.kind)} tone="warn" />
            </View>
            <Text style={s.muted}>
              {[r.area, r.hole_count ? `${r.hole_count} holes` : null, new Date(r.created_at).toLocaleDateString()]
                .filter(Boolean).join(' · ')}
            </Text>
            <Text style={[s.body, { marginTop: 6 }]}>{r.note}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Button title="Dismiss" variant="ghost" onPress={() => dismiss(r)} style={{ flex: 1 }} />
              <Button title="Fix course" variant="soft" onPress={() => setEditing(r.id)} style={{ flex: 1 }} />
            </View>
          </Card>
        ),
      )}
    </ScrollView>
  );
}

function Editor({ report, onCancel, onDone }: { report: CourseReport; onCancel: () => void; onDone: () => void }) {
  const origPars = report.pars ?? [];
  const [name, setName] = useState(report.course_name);
  const [area, setArea] = useState(report.area ?? '');
  const [pars, setPars] = useState<number[]>(origPars);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasLayout = report.layout_id !== null;

  function setCount(n: number) {
    if (n < 1 || n > 36) return;
    setPars((p) => Array.from({ length: n }, (_, i) => p[i] ?? 3));
  }

  async function apply() {
    setBusy(true);
    setError(null);
    const edits: { name?: string; area?: string; pars?: number[] } = {};
    if (name.trim() !== report.course_name) edits.name = name.trim();
    if (area.trim() !== (report.area ?? '')) edits.area = area.trim();
    if (hasLayout && !sameArray(pars, origPars)) edits.pars = pars;
    const err = await resolveReport(report.id, 'applied', edits);
    setBusy(false);
    if (err) setError(err);
    else onDone();
  }

  return (
    <Card selected>
      <Text style={s.h2}>{report.course_name}</Text>
      <Text style={s.body}>“{report.note}”</Text>
      <Field label="Course name" value={name} onChangeText={setName} maxLength={80} />
      <Field label="City / area" value={area} onChangeText={setArea} maxLength={80} />
      {hasLayout && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
            <Text style={s.label}>Holes</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <Pressable onPress={() => setCount(pars.length - 1)} accessibilityLabel="Remove a hole" hitSlop={8}>
                <Ionicons name="remove-circle" size={32} color={colors.brand} />
              </Pressable>
              <Text style={[s.h2, { minWidth: 28, textAlign: 'center' }]}>{pars.length}</Text>
              <Pressable onPress={() => setCount(pars.length + 1)} accessibilityLabel="Add a hole" hitSlop={8}>
                <Ionicons name="add-circle" size={32} color={colors.brand} />
              </Pressable>
            </View>
          </View>
          <ParGrid pars={pars} onChange={setPars} />
        </>
      )}
      {error && <Text style={s.error}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} disabled={busy} />
        <Button title={busy ? 'Saving…' : 'Apply fix'} onPress={apply} style={{ flex: 1 }} disabled={busy || name.trim().length < 2 || pars.length < 1} />
      </View>
    </Card>
  );
}
