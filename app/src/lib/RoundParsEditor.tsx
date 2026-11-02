import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { MAX_HOLES, MIN_HOLES, parsError, withHoleCount } from '@/domain/pars';
import { ParGrid } from '@/lib/ParGrid';
import { Button, Card, colors, s } from '@/lib/ui';

/**
 * Edits the holes and pars of the round being played. `scoredThrough` is the highest hole that already has a score,
 * which the round cannot shrink below. `onSave` resolves with an error message to show, or null when it saved.
 */
export function RoundParsEditor({ pars, scoredThrough, verified, onSave, onCancel }: {
  pars: number[];
  scoredThrough: number;
  verified: boolean;
  onSave: (pars: number[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(pars);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = parsError(draft, scoredThrough);

  async function save() {
    setBusy(true);
    const message = await onSave(draft);
    setBusy(false);
    if (message) setError(message);
  }

  return (
    <View style={{ gap: 10 }}>
      <Card style={{ gap: 8 }}>
        <Text style={s.h2}>Holes and pars for this round</Text>
        <Text style={s.muted}>
          {verified
            ? 'Changes apply to this round only.'
            : 'The pars for this course are not confirmed. Set them as you play: they apply to this round, and they help other players of the course.'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[s.body, { fontWeight: '600' }]}>Number of holes</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable accessibilityLabel="Fewer holes" disabled={draft.length <= Math.max(MIN_HOLES, scoredThrough)}
              onPress={() => setDraft(withHoleCount(draft, draft.length - 1))}
              style={{ opacity: draft.length <= Math.max(MIN_HOLES, scoredThrough) ? 0.3 : 1 }}>
              <Ionicons name="remove-circle" size={34} color={colors.brand} />
            </Pressable>
            <Text style={{ fontSize: 22, fontWeight: '800', minWidth: 28, textAlign: 'center', color: colors.ink }}>{draft.length}</Text>
            <Pressable accessibilityLabel="More holes" disabled={draft.length >= MAX_HOLES}
              onPress={() => setDraft(withHoleCount(draft, draft.length + 1))}
              style={{ opacity: draft.length >= MAX_HOLES ? 0.3 : 1 }}>
              <Ionicons name="add-circle" size={34} color={colors.brand} />
            </Pressable>
          </View>
        </View>
        {scoredThrough > 0 && (
          <Text style={[s.muted, { fontSize: 12 }]}>
            Hole {scoredThrough} already has a score, so the round keeps at least {scoredThrough} holes.
          </Text>
        )}
      </Card>
      <ParGrid pars={draft} onChange={(next) => { setDraft(next); setError(null); }} />
      {(error ?? problem) ? <Text style={s.error}>{error ?? problem}</Text> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Cancel" variant="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button title="Save" onPress={save} disabled={busy || !!problem} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
