import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { getSeatStatus, type SeatStatus } from '@/sync/social';
import {
  deleteRound, finishRound, getRound, isLayoutVerified, setLiveScore, setRoundPars, setScore, type RoundDetail,
} from '@/db/local';
import { canEditSeat, isLiveRound, liveBanner } from '@/domain/liveRound';
import { highestScoredHole } from '@/domain/pars';
import {
  clampStrokes, formatRelative, isComplete, relativeToPar, totalStrokes,
} from '@/domain/scoring';
import { useAuth } from '@/lib/auth';
import { maybeAskForReview } from '@/lib/reviewPrompt';
import { RoundParsEditor } from '@/lib/RoundParsEditor';
import { Badge, Button, Card, colors, radius, s } from '@/lib/ui';

/** How often a round in progress with other people refreshes while its screen is open. */
const LIVE_REFRESH_MS = 30_000;

export default function RoundScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { ownerId, guest, sync, pushSoon, syncTick } = useAuth();
  const [round, setRound] = useState<RoundDetail | null>(null);
  const [hole, setHole] = useState(1);
  const [editingPars, setEditingPars] = useState(false);
  const [layoutVerified, setLayoutVerified] = useState(true);

  const reload = useCallback(() => getRound(id).then(setRound), [id]);
  const layoutId = round?.layout_id;
  useEffect(() => {
    if (layoutId) void isLayoutVerified(layoutId).then(setLayoutVerified);
  }, [layoutId]);
  // Re-read after each sync so the "waiting to sync" / "synced" label stays current.
  useEffect(() => void reload(), [reload, syncTick]);

  // For rounds this person scored with registered friends: has each friend confirmed their scores yet?
  const [seatStatus, setSeatStatus] = useState<Record<string, SeatStatus> | null>(null);
  const hasConfirmSeats = !!round && !round.shared && !!round.finished_at
    && round.players.some((p) => p.user_id && p.user_id !== round.owner_id);
  useEffect(() => {
    if (!hasConfirmSeats || guest) return;
    let stale = false;
    getSeatStatus(id).then((st) => !stale && setSeatStatus(st));
    return () => {
      stale = true;
    };
  }, [hasConfirmSeats, guest, id, syncTick]);

  // A round in progress with other people in it keeps refreshing while this screen is open (the app also syncs when
  // it comes to the foreground), so what the others enter shows up without leaving the screen.
  const watching = !!round && !guest && isLiveRound(
    { live: round.live, shared: round.shared, finished: !!round.finished_at, ownerId: round.owner_id },
    round.players.map((p) => p.user_id));
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => void sync().catch(() => {}), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [watching, sync]);

  if (!round) return <View style={s.screen} />;

  const par = round.pars[hole - 1];
  const finished = !!round.finished_at;
  const complete = isComplete(round.hole_count, round.players.map((p) => p.scores));

  const seatRound = { live: round.live, shared: round.shared, finished };
  const editable = (userId: string | null) => canEditSeat(seatRound, userId, ownerId);
  const hasFriendSeats = round.players.some((p) => p.user_id && p.user_id !== round.owner_id);
  const banner = liveBanner({ live: round.live, ownerName: round.owner_name }, !round.shared && !finished && hasFriendSeats && !guest);

  async function bump(playerId: string, seatUserId: string | null, current: number | undefined, delta: number | 'par') {
    if (!editable(seatUserId)) return;
    const next = delta === 'par' || current === undefined
      ? clampStrokes(par + (delta === 'par' ? 0 : delta))
      : clampStrokes(current + delta);
    const now = new Date().toISOString();
    // In a round someone else owns, only our own seat can be written (and it goes out through sync_my_seat).
    if (round!.live) await setLiveScore(round!.id, hole, next, now);
    else await setScore(playerId, round!.id, hole, next, now);
    await reload();
    pushSoon();
  }

  async function finish() {
    await finishRound(round!.id, new Date().toISOString());
    await reload();
    sync();
    // A moment after the screen settles, and only when it is a good one; the store decides if the prompt shows.
    const id = round!.id;
    setTimeout(() => { void maybeAskForReview(ownerId, id); }, 1500);
  }

  async function saveParsEdit(pars: number[]): Promise<string | null> {
    const error = await setRoundPars(round!.id, pars);
    if (error) return error;
    setHole((h) => Math.min(h, pars.length));
    setEditingPars(false);
    await reload();
    pushSoon();
    return null;
  }

  // Only the person scoring a round in progress can change its holes and pars.
  const canEditPars = round.owner_id === ownerId && !round.shared && !finished;

  function confirmDelete() {
    const message = guest
      ? 'It will be removed from this phone.'
      : "It will be deleted from your account and removed from your friends' history. A friend who confirmed their own scores keeps those scores.";
    Alert.alert('Delete this round?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteRound(round!.id);
          sync(); // tell the server now if we are online; otherwise it is sent on the next sync
          router.back();
        },
      },
    ]);
  }

  const scoredHoles = (n: number) => round!.players.some((p) => p.scores[n] !== undefined);

  if (editingPars && canEditPars) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.muted}>{round.course_name}</Text>
        <RoundParsEditor
          pars={round.pars}
          scoredThrough={highestScoredHole(round.players.map((p) => p.scores))}
          verified={layoutVerified}
          onSave={saveParsEdit}
          onCancel={() => setEditingPars(false)} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad}>
      <Text style={s.muted}>{round.course_name}</Text>

      {/* Hole header */}
      <View style={{
        backgroundColor: colors.brand, borderRadius: radius.lg, padding: 16, flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <NavButton icon="chevron-back" label="Previous hole" onPress={() => setHole(Math.max(1, hole - 1))} disabled={hole === 1} />
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', letterSpacing: -0.5 }}>Hole {hole}</Text>
          <Text style={{ color: '#cfe9da', fontSize: 15, fontWeight: '600' }}>Par {par} · {hole} of {round.hole_count}</Text>
        </View>
        <NavButton icon="chevron-forward" label="Next hole" onPress={() => setHole(Math.min(round.hole_count, hole + 1))}
          disabled={hole === round.hole_count} />
      </View>

      {banner && (
        <View style={{ flexDirection: 'row', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.brandSoft }}>
          <Ionicons name="radio" size={22} color={colors.brandDark} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[s.h2, { fontSize: 15 }]}>{banner.title}</Text>
            <Text style={s.muted}>{banner.detail}</Text>
          </View>
        </View>
      )}

      {canEditPars && (
        <Pressable onPress={() => setEditingPars(true)} accessibilityRole="button" accessibilityLabel="Edit holes and pars"
          style={{ alignSelf: 'center', paddingVertical: 4 }}>
          <Text style={{ color: colors.brand, fontWeight: '700', fontSize: 14 }}>
            {layoutVerified ? 'Edit holes & pars' : 'Pars not confirmed · Edit holes & pars'}
          </Text>
        </Pressable>
      )}

      {/* Progress dots: tap to jump */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginVertical: 4 }}>
        {Array.from({ length: round.hole_count }, (_, i) => i + 1).map((n) => (
          <Pressable key={n} onPress={() => setHole(n)} hitSlop={9} accessibilityRole="button" accessibilityLabel={`Go to hole ${n}`}
            style={{
              width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
              backgroundColor: n === hole ? colors.ink : scoredHoles(n) ? colors.brandSoft : colors.card,
              borderWidth: 1.5, borderColor: n === hole ? colors.ink : scoredHoles(n) ? colors.brand : colors.line,
            }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: n === hole ? '#fff' : colors.ink }}>{n}</Text>
          </Pressable>
        ))}
      </View>

      {round.players.map((p) => {
        const strokes = p.scores[hole];
        const rel = formatRelative(relativeToPar(round.pars, p.scores));
        return (
          <Card key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text style={[s.h2, { fontSize: 17 }]} numberOfLines={1}>{p.display_name}</Text>
              <Text style={s.muted}>
                {totalStrokes(p.scores)} total · <Text style={{ fontWeight: '800', color: rel.startsWith('-') ? colors.brand : colors.muted }}>{rel}</Text>
              </Text>
            </View>
            <Stepper label="−" onPress={() => bump(p.id, p.user_id, strokes, -1)} disabled={!editable(p.user_id)} />
            <Pressable onPress={() => bump(p.id, p.user_id, strokes, 'par')} disabled={!editable(p.user_id)}
              style={{ width: 52, alignItems: 'center' }}
              accessibilityLabel={`${p.display_name} strokes, tap to set par`}>
              <Text style={{ fontSize: 38, fontWeight: '800', color: strokes === undefined ? colors.line : colors.ink }}>
                {strokes ?? par}
              </Text>
            </Pressable>
            <Stepper label="+" onPress={() => bump(p.id, p.user_id, strokes, 1)} disabled={!editable(p.user_id)} />
          </Card>
        );
      })}

      {!finished && !round.live && (
        <Button title={complete ? 'Finish round' : 'Finish round (some holes unscored)'} onPress={finish}
          variant={complete ? 'primary' : 'ghost'} style={{ marginTop: 12 }} />
      )}
      {finished && (
        <View style={{ alignItems: 'center', marginTop: 12, gap: 8 }}>
          {round.shared ? (
            <>
              <Badge label="Shared with you" />
              <Text style={[s.muted, { textAlign: 'center' }]}>Scored by someone you played with, so it's read-only.</Text>
            </>
          ) : (
            <Badge
              label={guest ? 'Finished · on this phone only' : round.dirty ? 'Finished · waiting to sync' : 'Finished · synced'}
              tone={!guest && round.dirty ? 'warn' : 'good'} />
          )}
        </View>
      )}
      {finished && hasConfirmSeats && seatStatus && (
        <Card style={{ gap: 6 }}>
          <Text style={s.label}>FRIENDS' CONFIRMATION</Text>
          {round.players.filter((p) => p.user_id && p.user_id !== round.owner_id).map((p) => {
            const st = seatStatus[p.id];
            return (
              <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>{p.display_name}</Text>
                <Badge
                  label={st === 'confirmed' ? 'Confirmed' : st === 'declined' ? 'Declined' : 'Waiting to confirm'}
                  tone={st === 'confirmed' ? 'good' : st === 'declined' ? 'neutral' : 'warn'} />
              </View>
            );
          })}
          <Text style={[s.muted, { fontSize: 12 }]}>
            A friend's scores join their history only after they confirm them.
          </Text>
        </Card>
      )}
      {round.owner_id === ownerId && !round.shared && (
        <Button title="Delete round" variant="ghost" onPress={confirmDelete} />
      )}
    </ScrollView>
  );
}

function NavButton({ icon, label, onPress, disabled }: {
  icon: 'chevron-back' | 'chevron-forward'; label: string; onPress: () => void; disabled?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label}
      style={{
        width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center',
        justifyContent: 'center', opacity: disabled ? 0.3 : 1,
      }}>
      <Ionicons name={icon} size={26} color="#fff" />
    </Pressable>
  );
}

function Stepper({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={label === '+' ? 'Add stroke' : 'Remove stroke'}
      style={({ pressed }) => ({
        width: 50, height: 50, borderRadius: 25, backgroundColor: label === '+' ? colors.brand : colors.brandSoft,
        alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : pressed ? 0.8 : 1,
      })}>
      <Ionicons name={label === '+' ? 'add' : 'remove'} size={28} color={label === '+' ? '#fff' : colors.brandDark} />
    </Pressable>
  );
}
