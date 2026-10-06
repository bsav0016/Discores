import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Text } from 'react-native';
import { normalizeCode } from '@/lib/invite';
import { Button, Card, colors, s } from '@/lib/ui';
import { addFriend } from '@/sync/social';

/** Opened from an invite link or QR code. Nothing is sent until the person confirms. */
export default function FriendInvite() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { guest, endGuest } = useAuth();
  const code = normalizeCode(raw);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function send() {
    if (!code) return;
    setBusy(true);
    setResult(await addFriend(code));
    setBusy(false);
  }

  if (guest) {
    return (
      <Card style={{ margin: 16, alignItems: 'center', gap: 10 }}>
        <Text style={s.h2}>Make an account to add friends</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Sign up or sign in and this invite will be waiting for you.
        </Text>
        <Button title="Create an account or sign in" onPress={() => { void endGuest(); router.back(); }}
          style={{ alignSelf: 'stretch' }} />
        <Button title="Not now" variant="ghost" onPress={() => router.back()} style={{ alignSelf: 'stretch', marginTop: 0 }} />
      </Card>
    );
  }

  return (
    <Card style={{ margin: 16, alignItems: 'center', gap: 10 }}>
      {code ? (
        <>
          <Text style={s.label}>FRIEND INVITE</Text>
          <Text style={{ fontSize: 34, fontWeight: '800', letterSpacing: 4, color: colors.ink }}>{code}</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Send this person a friend request? They need to accept it before you can add each other to rounds.
          </Text>
          {result && <Text style={result.ok ? [s.body, { color: colors.brandDark }] : s.error}>{result.message}</Text>}
          {result?.ok ? (
            <Button title="Done" onPress={() => router.replace('/friends')} style={{ alignSelf: 'stretch' }} />
          ) : (
            <Button title={busy ? 'Sending…' : 'Send friend request'} onPress={send} disabled={busy}
              style={{ alignSelf: 'stretch' }} />
          )}
        </>
      ) : (
        <Text style={s.error}>This invite link isn't valid.</Text>
      )}
      {!result?.ok && <Button title="Not now" variant="ghost" onPress={() => router.replace('/friends')}
        style={{ alignSelf: 'stretch', marginTop: 0 }} />}
    </Card>
  );
}
