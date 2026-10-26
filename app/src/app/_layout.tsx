import * as Linking from 'expo-linking';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { codeFromUrl } from '@/lib/invite';
import { savePendingInvite, takePendingInvite } from '@/lib/pendingInvite';
import { parseConfirmUrl, parseRecoveryUrl } from '@/lib/recovery';
import { usePushTaps } from '@/lib/usePushTaps';
import { ResetPasswordScreen } from '@/lib/ResetPasswordScreen';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Alert, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, s } from '@/lib/ui';

function Routes() {
  const { session, loading, guest, needsProfile, recovering, startRecovery, confirmEmail, sync } = useAuth();
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const signedIn = !!session && !needsProfile;
  usePushTaps(signedIn && !recovering, sync);

  // An invite opened while signed out is remembered, then shown once the person is in.
  useEffect(() => {
    const code = codeFromUrl(url);
    if (code && !signedIn && !loading) void savePendingInvite(code);
  }, [url, signedIn, loading]);

  useEffect(() => {
    if (!signedIn) return;
    void takePendingInvite().then((code) => {
      if (code) router.push({ pathname: '/friend/[code]', params: { code } });
    });
  }, [signedIn, router]);

  // The link in a password-reset email signs the person in and asks for a new password before anything else.
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!url || loading || handledLink.current === url) return;
    const link = parseRecoveryUrl(url);
    if (!link) return;
    handledLink.current = url;
    if ('error' in link) Alert.alert('Link expired', link.error);
    else void startRecovery(link).then((err) => err && Alert.alert('Link expired', err));
  }, [url, loading, startRecovery]);

  // The link in the sign-up confirmation email signs the person in.
  useEffect(() => {
    if (!url || loading || handledLink.current === url) return;
    const link = parseConfirmUrl(url);
    if (!link) return;
    handledLink.current = url;
    if ('error' in link) Alert.alert('Link expired', link.error);
    else void confirmEmail(link).then((err) => err && Alert.alert('Link expired', err));
  }, [url, loading, confirmEmail]);

  if (loading) {
    return (
      <View style={[s.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }
  if (recovering) return <ResetPasswordScreen />;
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brandDark,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: '800' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Protected guard={signedIn || guest}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="new-round" options={{ title: 'New round', presentation: 'modal' }} />
        <Stack.Screen name="add-course" options={{ title: 'Add a course' }} />
        <Stack.Screen name="report-course" options={{ title: 'Report a problem' }} />
        <Stack.Screen name="review-reports" options={{ title: 'Reports' }} />
        <Stack.Screen name="round/[id]" options={{ title: 'Round' }} />
        <Stack.Screen name="person/[id]" options={{ title: 'Person' }} />
        <Stack.Screen name="confirm-rounds" options={{ title: 'Confirm scores' }} />
        <Stack.Screen name="change-password" options={{ title: 'Change password' }} />
        <Stack.Screen name="scan" options={{ title: 'Scan QR code', presentation: 'modal' }} />
        <Stack.Screen name="friend/[code]" options={{ title: 'Friend invite', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={needsProfile}>
        <Stack.Screen name="complete-profile" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!session && !guest}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="auth-callback" options={{ headerShown: false }} />
      <Stack.Screen name="reset-password" options={{ headerShown: false }} />
      <Stack.Screen name="confirm-email" options={{ headerShown: false }} />
      <Stack.Screen name="legal/[doc]" options={{ title: 'Legal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  if (!isSupabaseConfigured) {
    return (
      <View style={[s.screen, s.pad, { justifyContent: 'center' }]}>
        <Text style={s.h2}>Supabase isn't configured</Text>
        <Text style={s.body}>
          Copy .env.example to .env, fill in EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, then
          restart with `npx expo start --clear`.
        </Text>
      </View>
    );
  }
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <Routes />
    </AuthProvider>
  );
}
