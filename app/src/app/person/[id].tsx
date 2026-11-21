import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { Button, Card, Chip, colors, Field, s, SectionTitle } from '@/lib/ui';
import { listFriends } from '@/db/local';
import { useTogether } from '@/lib/useTogether';
import { TogetherCard } from '@/lib/TogetherViews';
import { blockUser, removeFriend, REPORT_REASONS, reportUser, type ReportReason } from '@/sync/social';

/** Actions for one person from the Friends tab: remove, report, block. */
export default function Person() {
  const { id, name, fid: fidParam, kind } = useLocalSearchParams<{ id: string; name: string; fid?: string; kind?: string }>();
  const router = useRouter();
  const together = useTogether();
  // Opened from Stats, the friendship id is not passed along; look it up so Remove works from here too.
  const [fidFound, setFidFound] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (fidParam || kind !== 'friend') return;
    void listFriends().then((fs) => setFidFound(fs.find((f) => f.user_id === id)?.friendship_id));
  }, [fidParam, kind, id]);
  const fid = fidParam ?? fidFound;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reported, setReported] = useState(false);

  async function sendReport() {
    if (!reason) return;
    setBusy(true);
    const r = await reportUser(id, reason, note.trim());
    setBusy(false);
    setResult(r);
    if (r.ok) setReported(true);
  }

  function confirmBlock() {
    Alert.alert(
      `Block ${name}?`,
      "They'll be removed from your friends, and won't be able to find or add you. Rounds you already played together stay. You can unblock them later from Friends.",
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            const err = await blockUser(id);
            if (err) Alert.alert("Couldn't block", err);
            else router.back();
          },
        },
      ],
    );
  }

  async function remove() {
    const err = fid ? await removeFriend(fid) : null;
    if (err) Alert.alert("That didn't work", err);
    else router.back();
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={s.h2}>{name}</Text>
        <Text style={s.muted}>
          {kind === 'friend' ? 'Friend' : kind === 'incoming' ? 'Sent you a friend request' : 'Friend request pending'}
        </Text>
      </Card>

      {kind === 'friend' && together && (
        <TogetherCard name={name} record={together.records.find((r) => r.userId === id)} />
      )}

      {kind === 'friend' && fid && <Button title="Remove friend" variant="ghost" onPress={remove} />}

      <SectionTitle>Report</SectionTitle>
      {reported ? (
        <Text style={[s.body, { color: colors.brandDark }]}>{result?.message}</Text>
      ) : (
        <>
          <Text style={s.muted}>Why are you reporting {name}?</Text>
          {REPORT_REASONS.map((r) => (
            <Chip key={r.value} label={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
          <Field label="Anything we should know? (optional)" value={note} onChangeText={setNote} maxLength={500} multiline />
          {result && !result.ok && <Text style={s.error}>{result.message}</Text>}
          <Button title={busy ? 'Sending…' : 'Send report'} variant="soft" onPress={sendReport} disabled={busy || !reason} />
        </>
      )}

      <SectionTitle>Block</SectionTitle>
      <Text style={s.muted}>
        Blocking removes {name} from your friends and stops them finding you by code, email or username.
      </Text>
      <Button title={`Block ${name}`} variant="danger" onPress={confirmBlock} />
    </ScrollView>
  );
}
