import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createRound, listFriends, listLayouts, upsertLayout, type FriendRow, type LayoutRow } from '@/db/local';
import { COURSE_DATA_CREDIT } from '@/lib/attribution';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Chip, colors, Field, radius, s, SectionTitle } from '@/lib/ui';
import { syncNow } from '@/sync';
import { searchCourses } from '@/sync/courses';
import { refreshFriends } from '@/sync/social';

export default function NewRound() {
  const { session, ownerId, guest, sync, syncTick } = useAuth();
  const router = useRouter();
  const [cached, setCached] = useState<LayoutRow[] | null>(null);
  const [picked, setPicked] = useState<LayoutRow | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LayoutRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [guests, setGuests] = useState<string[]>([]);
  const [guestInput, setGuestInput] = useState('');
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [pickedFriends, setPickedFriends] = useState<string[]>([]); // friend user ids

  // Courses already on this device (played, picked or added): usable offline. Re-read after each sync.
  useEffect(() => {
    listLayouts().then(setCached);
    if (guest) return; // friends need an account
    const loadFriends = () => listFriends().then((all) => setFriends(all.filter((f) => f.kind === 'friend')));
    void loadFriends();
    // Someone may have accepted since the last sync; offline this just keeps the cached list.
    refreshFriends().then((ok) => {
      if (ok) void loadFriends();
    });
  }, [syncTick]);

  const MAX_PLAYERS = 8; // you + friends + guests
  const seatsLeft = MAX_PLAYERS - 1 - guests.length - pickedFriends.length;

  // Debounced server search; results are only needed while typing.
  const q = query.trim();
  useEffect(() => {
    if (q.length < 2) {
      setResults(null);
      setSearchError(null);
      return;
    }
    let stale = false;
    const t = setTimeout(async () => {
      const r = await searchCourses(q);
      if (stale) return;
      if ('error' in r) {
        setResults([]);
        setSearchError("Can't reach the course list right now. Courses saved on this device still work.");
      } else {
        setResults(r.layouts);
        setSearchError(null);
      }
    }, 300);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q]);

  function pick(l: LayoutRow) {
    setPicked(l);
    upsertLayout(l).then(() => listLayouts().then(setCached)); // cache it so the round works offline
  }

  function addGuest() {
    const name = guestInput.trim();
    if (name && seatsLeft > 0) setGuests([...guests, name]);
    setGuestInput('');
  }

  async function start() {
    if (!picked) return;
    const id = Crypto.randomUUID();
    await createRound({
      id,
      ownerId,
      layout: picked,
      startedAt: new Date().toISOString(),
      players: [
        {
          id: Crypto.randomUUID(), userId: ownerId, guestName: null,
          name: (session?.user.user_metadata?.display_name as string | undefined) ?? 'You',
        },
        ...friends
          .filter((f) => pickedFriends.includes(f.user_id))
          .map((f) => ({ id: Crypto.randomUUID(), userId: f.user_id, guestName: null, name: f.display_name })),
        ...guests.map((g) => ({ id: Crypto.randomUUID(), userId: null, guestName: g })),
      ],
    });
    if (session) syncNow(session.user.id).then(() => sync()).catch(() => {}); // best effort; stays dirty if offline
    router.replace({ pathname: '/round/[id]', params: { id } });
  }

  const searching = q.length >= 2;
  const list = searching ? results : cached;

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <SectionTitle>Course</SectionTitle>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.card, borderRadius: radius.md,
        borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: 12,
      }}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search courses by name or city"
          placeholderTextColor={colors.muted} autoCorrect={false}
          style={{ flex: 1, paddingVertical: 13, fontSize: 16, color: colors.ink }} />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} accessibilityLabel="Clear search" hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {!searching && <Text style={s.muted}>{cached?.length ? 'On this device' : ''}</Text>}
      {searchError && <Text style={s.error}>{searchError}</Text>}
      {list === null ? null : list.length === 0 ? (
        <Card>
          <Text style={s.body}>{searching ? 'No courses match that search.' : 'No courses on this device yet.'}</Text>
          <Text style={s.muted}>
            {searching ? "Can't find it? Add it so you and others can play it." : 'Search above to find your course.'}
          </Text>
        </Card>
      ) : (
        list.map((l) => (
          <Card key={l.layout_id} selected={picked?.layout_id === l.layout_id} onPress={() => pick(l)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <Text style={[s.h2, { flex: 1 }]}>{l.course_name}</Text>
              {picked?.layout_id === l.layout_id && <Ionicons name="checkmark-circle" size={22} color={colors.brand} />}
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 2 }}>
              <Badge label={`${l.hole_count} holes`} />
              {!l.verified && <Badge label="Pars not confirmed" tone="warn" />}
              {l.area ? <Text style={s.muted}>{l.area}</Text> : null}
            </View>
          </Card>
        ))
      )}

      {!guest && <Button title="Add a course" variant="soft" onPress={() => router.push('/add-course')} />}
      {picked && !guest && (
        <Pressable onPress={() => router.push({ pathname: '/report-course', params: { id: picked.course_id, name: picked.course_name } })}
          style={{ alignSelf: 'center', padding: 8 }}>
          <Text style={{ color: colors.muted, textDecorationLine: 'underline' }}>Something wrong with {picked.course_name}?</Text>
        </Pressable>
      )}

      <SectionTitle>Players</SectionTitle>
      <Text style={s.muted}>You're added automatically.</Text>
      {friends.length > 0 && (
        <>
          <Text style={s.label}>Friends</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {friends.map((f) => {
              const on = pickedFriends.includes(f.user_id);
              return (
                <Chip key={f.user_id} label={f.display_name} selected={on}
                  onPress={() =>
                    setPickedFriends(on ? pickedFriends.filter((x) => x !== f.user_id) : seatsLeft > 0 ? [...pickedFriends, f.user_id] : pickedFriends)} />
              );
            })}
          </View>
          <Text style={s.muted}>When the round is finished, friends are asked to confirm their scores before it is added to their history.</Text>
        </>
      )}
      <Text style={s.label}>Guests (people without the app)</Text>
      {guests.map((g, i) => (
        <Card key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
          <Text style={s.body}>{g}</Text>
          <Pressable onPress={() => setGuests(guests.filter((_, j) => j !== i))} accessibilityRole="button"
            accessibilityLabel={`Remove ${g}`} hitSlop={10}>
            <Text style={{ color: colors.danger, fontWeight: '600' }}>Remove</Text>
          </Pressable>
        </Card>
      ))}
      <Field label="Guest name" value={guestInput} onChangeText={setGuestInput} maxLength={40}
        onSubmitEditing={addGuest} returnKeyType="done" />
      <Button title="Add guest" variant="ghost" onPress={addGuest} disabled={!guestInput.trim()} />

      <Button title="Start round" onPress={start} disabled={!picked} style={{ marginTop: 16 }} />
      <Text style={[s.muted, { textAlign: 'center', fontSize: 12 }]}>
        {COURSE_DATA_CREDIT}
      </Text>
    </ScrollView>
  );
}
