import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, Switch, Text, View } from 'react-native';
import { COURSE_DATA_CREDIT } from '@/lib/attribution';
import { useAuth } from '@/lib/auth';
import { LegalLinks } from '@/lib/LegalLinks';
import { Button, Card, colors, Field, s, SectionTitle } from '@/lib/ui';
import { isAdmin } from '@/sync/admin';
import { getFindability, saveUsername, setDiscoverable } from '@/sync/social';

export default function Settings() {
  const { session, guest, endGuest, signOut, deleteAccount, sync } = useAuth();
  const [msg, setMsg] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const [discoverable, setDiscoverableState] = useState<boolean | null>(null);
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState<string | null>(null);
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  // Checked on every focus so a newly granted admin sees the entry without restarting.
  const userId = session?.user.id;
  useFocusEffect(useCallback(() => {
    void isAdmin().then(setAdmin);
    if (userId) {
      void getFindability(userId).then((f) => {
        if (!f) return;
        setDiscoverableState(f.discoverable);
        setSavedUsername(f.username);
        setUsername(f.username ?? '');
      });
    }
  }, [userId]));

  async function saveName() {
    const r = await saveUsername(username);
    setUsernameMsg(r);
    if (r.ok && userId) {
      const f = await getFindability(userId);
      setSavedUsername(f?.username ?? null);
      setUsername(f?.username ?? '');
    }
  }

  async function toggleDiscoverable(value: boolean) {
    if (!userId) return;
    setDiscoverableState(value);
    const err = await setDiscoverable(userId, value);
    if (err) {
      setDiscoverableState(!value);
      setMsg("Couldn't save that. Check your connection and try again.");
    }
  }

  function confirmDelete() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and profile. Rounds you played with other registered players stay in their history with your name replaced by "Deleted player". Your other rounds are deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: async () => setMsg(await deleteAccount()) },
      ],
    );
  }

  if (guest) {
    return (
      <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad}>
        <Card style={{ gap: 8 }}>
          <Text style={s.h2}>You're using Discores as a guest</Text>
          <Text style={s.muted}>
            Your rounds are saved on this phone only. If you lose or reset the phone they're gone. Create a free account
            to back them up, add friends and play on more than one device. The rounds you've scored will move to it.
          </Text>
          <Button title="Create an account or sign in" onPress={endGuest} />
        </Card>
        <View style={{ marginTop: 12 }}><LegalLinks lead="Read our" /></View>
        <Text style={[s.muted, { fontSize: 12, textAlign: 'center', marginTop: 12 }]}>{COURSE_DATA_CREDIT}</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{
          width: 48, height: 48, borderRadius: 24, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="person" size={24} color={colors.brandDark} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.muted}>Signed in as</Text>
          <Text style={s.body} numberOfLines={1}>{session?.user.email}</Text>
        </View>
      </Card>

      <SectionTitle>Be findable</SectionTitle>
      <Card style={{ gap: 8 }}>
        <Field label="Username (optional)" value={username} onChangeText={(v) => setUsername(v.replace(/^@/, ''))}
          autoCapitalize="none" autoCorrect={false} maxLength={20} placeholder="e.g. sam_throws" />
        <Text style={[s.muted, { fontSize: 13 }]}>
          Anyone who types your exact username can send you a friend request, so pick one you're happy to share.
          3 to 20 letters, numbers or underscores. You can change it once every 30 days. Leave it empty to be
          unfindable by username.
        </Text>
        {usernameMsg && <Text style={usernameMsg.ok ? [s.body, { color: colors.brandDark }] : s.error}>{usernameMsg.message}</Text>}
        <Button title="Save username" variant="soft" onPress={saveName}
          disabled={username.trim().toLowerCase() === (savedUsername ?? '')} style={{ marginTop: 0 }} />
      </Card>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.body}>Let people find me by email</Text>
          <Text style={[s.muted, { fontSize: 13 }]}>
            Someone who types your exact email address can send you a friend request. Off by default. Your friend code
            always works.
          </Text>
        </View>
        <Switch value={!!discoverable} disabled={discoverable === null} onValueChange={toggleDiscoverable}
          trackColor={{ true: colors.brand }} accessibilityLabel="Let people find me by email" />
      </Card>

      <SectionTitle>Data</SectionTitle>
      <Button title="Sync now" variant="soft" onPress={() => sync().then(() => setMsg('Synced.'))} style={{ marginTop: 0 }} />
      {msg && <Text style={[s.muted, { textAlign: 'center' }]}>{msg}</Text>}

      {admin && (
        <>
          <SectionTitle>Admin</SectionTitle>
          <Button title="Review reports" variant="soft" onPress={() => router.push('/review-reports')}
            style={{ marginTop: 0 }} />
        </>
      )}

      <SectionTitle>Account</SectionTitle>
      {session?.user.app_metadata?.providers?.includes('email') && (
        // Apple and Google accounts have no password here to change.
        <Button title="Change password" variant="soft" onPress={() => router.push('/change-password')}
          style={{ marginTop: 0 }} />
      )}
      <Button title="Sign out" variant="ghost" onPress={signOut} style={{ marginTop: 0 }} />
      <Button title="Delete account and data" variant="danger" onPress={confirmDelete} />
      <View style={{ marginTop: 12 }}><LegalLinks lead="Read our" /></View>
      <Text style={[s.muted, { fontSize: 12, textAlign: 'center', marginTop: 12 }]}>
        {COURSE_DATA_CREDIT}
      </Text>
    </ScrollView>
  );
}
