import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import { Alert, ScrollView, Share, Text, View } from 'react-native';
import { listFriends, type FriendRow } from '@/db/local';
import { useAuth } from '@/lib/auth';
import { inviteLink } from '@/lib/invite';
import { Badge, Button, Card, colors, Field, s, SectionTitle } from '@/lib/ui';
import {
  addFriend, listBlocked, myFriendCode, refreshFriends, removeFriend, respondToRequest, unblockUser, type BlockedPerson,
} from '@/sync/social';

export default function Friends() {
  const { guest, endGuest } = useAuth();
  if (!guest) return <FriendsList />;
  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Ionicons name="people-outline" size={40} color={colors.line} />
        <Text style={s.h2}>Friends need an account</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Create a free account to add friends, put them in your rounds and see shared rounds in your history.
          Rounds you score as a guest are kept and move to your account.
        </Text>
        <Button title="Create an account or sign in" onPress={endGuest} style={{ alignSelf: 'stretch' }} />
      </Card>
    </ScrollView>
  );
}

function FriendsList() {
  const { syncTick } = useAuth();
  const router = useRouter();
  const [blocked, setBlocked] = useState<BlockedPerson[]>([]);
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reloadLocal = useCallback(() => listFriends().then(setFriends), []);

  // Show the cached list at once, then refresh from the server.
  useFocusEffect(
    useCallback(() => {
      void reloadLocal();
      refreshFriends().then((ok) => {
        setOffline(!ok);
        if (ok) void reloadLocal();
      });
      myFriendCode().then((c) => c && setCode(c));
      listBlocked().then((b) => b && setBlocked(b));
    }, [reloadLocal, syncTick]),
  );

  async function add() {
    setBusy(true);
    setResult(null);
    const r = await addFriend(input);
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setInput('');
      if (await refreshFriends()) void reloadLocal();
    }
  }

  async function act(run: () => Promise<string | null>) {
    const err = await run();
    if (err) Alert.alert("That didn't work", err);
    if (await refreshFriends()) void reloadLocal();
  }

  const openPerson = (f: FriendRow) =>
    router.push({
      pathname: '/person/[id]',
      params: { id: f.user_id, name: f.display_name, fid: f.friendship_id, kind: f.kind },
    });

  async function unblock(p: BlockedPerson) {
    const err = await unblockUser(p.user_id);
    if (err) Alert.alert("That didn't work", err);
    const b = await listBlocked();
    if (b) setBlocked(b);
  }

  const incoming = friends.filter((f) => f.kind === 'incoming');
  const accepted = friends.filter((f) => f.kind === 'friend');
  const outgoing = friends.filter((f) => f.kind === 'outgoing');

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {offline && <Text style={s.error}>Offline. Showing your saved friends.</Text>}

      <Card style={{ alignItems: 'center', gap: 6 }}>
        <Text style={s.label}>YOUR FRIEND CODE</Text>
        <Text style={{ fontSize: 34, fontWeight: '800', letterSpacing: 4, color: colors.ink }} selectable>
          {code ?? '········'}
        </Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Show the QR code or send the link to people you play with. Only people who have your code can ask to be your friend.
        </Text>
        {code && (
          <View style={{ padding: 10, backgroundColor: '#fff', borderRadius: 12, marginVertical: 6 }}>
            <QRCode value={inviteLink(code)} size={150} />
          </View>
        )}
        <Button title="Share invite link" variant="soft" disabled={!code}
          onPress={() => Share.share({
            message: `Add me on Discores. Friend code: ${code}
${inviteLink(code!)}`,
          })}
          style={{ alignSelf: 'stretch' }} />
      </Card>

      <SectionTitle>Add a friend</SectionTitle>
      <Field label="Their code, @username or email" value={input}
        onChangeText={(t) => setInput(/^[A-Za-z0-9]{1,8}$/.test(t) ? t.toUpperCase() : t)}
        autoCapitalize="none" autoCorrect={false} placeholder="K7M2QX9A, @username or an email"
        onSubmitEditing={add} returnKeyType="done" />
      <Button title="Scan a friend's QR code" variant="soft" onPress={() => router.push('/scan')}
        style={{ marginTop: 0 }} />
      <Text style={[s.muted, { fontSize: 12 }]}>
        Usernames and emails only find people who set them up in Settings. A friend code always works.
      </Text>
      {result && (
        <Text style={result.ok ? [s.body, { color: colors.brandDark }] : s.error}>{result.message}</Text>
      )}
      <Button title={busy ? 'Sending…' : 'Add friend'} onPress={add} disabled={busy || input.trim().length < (input.trim().startsWith('@') || input.includes('@') ? 4 : 8)} />

      {incoming.length > 0 && (
        <>
          <SectionTitle>Requests</SectionTitle>
          {incoming.map((f) => (
            <Card key={f.friendship_id} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.h2, { flex: 1 }]} numberOfLines={1}>{f.display_name}</Text>
                <Badge label="Wants to be friends" tone="warn" />
              </View>
              <Text onPress={() => openPerson(f)} style={{ color: colors.muted, fontWeight: '600' }}>
                Report or block
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Decline" variant="ghost" style={{ flex: 1, marginTop: 0 }}
                  onPress={() => act(() => respondToRequest(f.friendship_id, false))} />
                <Button title="Accept" style={{ flex: 1, marginTop: 0 }}
                  onPress={() => act(() => respondToRequest(f.friendship_id, true))} />
              </View>
            </Card>
          ))}
        </>
      )}

      <SectionTitle>Friends</SectionTitle>
      {accepted.length === 0 ? (
        <Card style={{ alignItems: 'center', gap: 6 }}>
          <Ionicons name="people-outline" size={36} color={colors.line} />
          <Text style={s.body}>No friends yet</Text>
          <Text style={[s.muted, { textAlign: 'center' }]}>
            Friends you add can be players in your rounds, and finished rounds show up in everyone's history.
          </Text>
        </Card>
      ) : (
        accepted.map((f) => (
          <Card key={f.friendship_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
            <View style={{
              width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{ color: colors.brandDark, fontWeight: '800', fontSize: 16 }}>
                {f.display_name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
            <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{f.display_name}</Text>
            <Text onPress={() => openPerson(f)} style={{ color: colors.muted, fontWeight: '600', padding: 6 }}>
              More
            </Text>
          </Card>
        ))
      )}

      {outgoing.length > 0 && (
        <>
          <SectionTitle>Waiting for them to accept</SectionTitle>
          {outgoing.map((f) => (
            <Card key={f.friendship_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{f.display_name}</Text>
              <Text onPress={() => act(() => removeFriend(f.friendship_id))}
                style={{ color: colors.muted, fontWeight: '600', padding: 6 }}>
                Cancel
              </Text>
            </Card>
          ))}
        </>
      )}

      {blocked.length > 0 && (
        <>
          <SectionTitle>Blocked</SectionTitle>
          {blocked.map((p) => (
            <Card key={p.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}>
              <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{p.display_name}</Text>
              <Text onPress={() => unblock(p)} style={{ color: colors.brandDark, fontWeight: '600', padding: 6 }}>
                Unblock
              </Text>
            </Card>
          ))}
        </>
      )}
    </ScrollView>
  );
}
