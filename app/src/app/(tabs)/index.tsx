import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { listRounds } from '@/db/local';
import { formatRelative } from '@/domain/scoring';
import { roundSyncLabel, syncBanner } from '@/domain/syncStatus';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, colors, s } from '@/lib/ui';

type Row = Awaited<ReturnType<typeof listRounds>>[number];

export default function History() {
  const { ownerId, guest, syncTick, pendingCount, sync } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const [rounds, setRounds] = useState<Row[]>([]);
  const [refreshing, setRefreshing] = useState(false); // the header button
  const [pulling, setPulling] = useState(false); // pull down on the list
  const uid = ownerId;
  const banner = guest ? null : syncBanner(rounds);

  const refresh = useCallback(async (setBusy: (v: boolean) => void) => {
    setBusy(true);
    await sync().catch(() => {});
    setBusy(false);
  }, [sync]);

  // A refresh button in the header, for people who don't think to pull the list down. Guests have nothing to sync.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: guest ? undefined : () => (
        <Pressable onPress={() => void refresh(setRefreshing)} disabled={refreshing} hitSlop={12}
          accessibilityRole="button" accessibilityLabel="Refresh" accessibilityState={{ busy: refreshing }}
          style={{ marginRight: 16, padding: 4, minWidth: 32, alignItems: 'center' }}>
          {refreshing
            ? <ActivityIndicator color={colors.brand} />
            : <Ionicons name="refresh" size={24} color={colors.brandDark} />}
        </Pressable>
      ),
    });
  }, [navigation, guest, refresh, refreshing]);

  useFocusEffect(
    useCallback(() => {
      listRounds(uid).then(setRounds);
    }, [uid, syncTick]),
  );

  return (
    <View style={s.screen}>
      <FlatList
        data={rounds}
        keyExtractor={(r) => r.id}
        contentContainerStyle={[s.pad, { gap: 12 }]}
        refreshControl={guest ? undefined : (
          <RefreshControl refreshing={pulling} onRefresh={() => void refresh(setPulling)}
            tintColor={colors.brand} colors={[colors.brand]} />
        )}
        ListHeaderComponent={
          <View style={{ gap: 12 }}>
            {banner && (
              <View accessibilityRole="alert" style={{
                flexDirection: 'row', gap: 12, padding: 14, borderRadius: 14,
                backgroundColor: banner.tone === 'danger' ? colors.dangerSoft : '#fdf0d8',
              }}>
                <Ionicons name={banner.tone === 'danger' ? 'alert-circle' : 'cloud-offline'} size={26}
                  color={banner.tone === 'danger' ? colors.danger : '#8a5a00'} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.h2}>{banner.title}</Text>
                  <Text style={s.muted}>{banner.detail}</Text>
                </View>
              </View>
            )}
            {pendingCount > 0 && (
              <Card onPress={() => router.push('/confirm-rounds')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Ionicons name="checkmark-done-circle" size={30} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={s.h2}>
                    {pendingCount} round{pendingCount === 1 ? '' : 's'} to confirm
                  </Text>
                  <Text style={s.muted}>A friend entered your scores. Check them to add them to your history.</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Card>
            )}
            <Button title="Start a round" onPress={() => router.push('/new-round')} style={{ marginTop: 0 }} />
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 48, gap: 8 }}>
            <Ionicons name="disc-outline" size={56} color={colors.line} />
            <Text style={s.h2}>No rounds yet</Text>
            <Text style={[s.muted, { textAlign: 'center' }]}>Start one and it will show up here.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const rel = formatRelative(item.relative);
          const syncLabel = guest ? null : roundSyncLabel(item);
          return (
            <Card onPress={() => router.push({ pathname: '/round/[id]', params: { id: item.id } })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.h2} numberOfLines={2}>{item.course_name}</Text>
                <Text style={s.muted}>
                  {new Date(item.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  {' · '}{item.scored}/{item.hole_count} holes
                </Text>
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
                  <Badge label={item.finished_at ? 'Finished' : 'In progress'} tone={item.finished_at ? 'good' : 'warn'} />
                  {item.shared ? <Badge label="Shared with you" /> : null}
                  {guest ? <Badge label="On this phone only" /> : syncLabel ? <Badge label={syncLabel.label} tone={syncLabel.tone} /> : null}
                </View>
              </View>
              <View style={{ alignItems: 'center', minWidth: 60 }}>
                <Text style={{ fontSize: 30, fontWeight: '800', color: colors.ink }}>{item.total}</Text>
                <Text style={{ fontSize: 13, fontWeight: '700', color: rel.startsWith('-') ? colors.brand : colors.muted }}>{rel}</Text>
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}
