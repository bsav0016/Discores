import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { LegalLinks } from '@/lib/LegalLinks';
import { Button, colors, Field, s } from '@/lib/ui';

export default function SignIn() {
  const { signIn, signInWithApple, signInWithGoogle, startGuest } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    // Only iPhones can show Sign in with Apple; elsewhere this resolves false and the button stays hidden.
    AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => {});
  }, []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(await signIn(email.trim(), password));
    setBusy(false);
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 72 }]} keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: 'center', gap: 8, marginBottom: 20 }}>
        <View style={{
          width: 76, height: 76, borderRadius: 38, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center',
        }}>
          <Ionicons name="disc" size={42} color="#fff" />
        </View>
        <Text style={s.h1}>Discores</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>Free disc golf scorekeeping you can share with friends.</Text>
      </View>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" />
      <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Signing in…' : 'Sign in'} onPress={submit} disabled={busy || !email || !password} style={{ marginTop: 14 }} />
      <Link href="/forgot-password" style={[s.body, { textAlign: 'center', marginTop: 12, color: colors.brandDark, fontWeight: '600' }]}>
        Forgot password?
      </Link>
      <Text style={[s.muted, { textAlign: 'center', marginTop: 8 }]}>or</Text>
      <Button title="Continue with Google" variant="soft" onPress={async () => setError(await signInWithGoogle())}
        style={{ marginTop: 8 }} />
      {appleAvailable && (
        <>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={14}
            style={{ height: 50, marginTop: 8 }}
            onPress={async () => setError(await signInWithApple())}
          />
        </>
      )}
      <Link href="/sign-up" style={[s.body, { textAlign: 'center', marginTop: 16, color: colors.brandDark, fontWeight: '600' }]}>
        New here? Create an account
      </Link>
      <Button title="Try it without an account" variant="ghost" onPress={startGuest} style={{ marginTop: 8 }} />
      <Text style={[s.muted, { textAlign: 'center', fontSize: 12 }]}>
        Score rounds on this phone. Make an account later to keep them and play with friends.
      </Text>
      <View style={{ marginTop: 18 }}><LegalLinks /></View>
    </ScrollView>
  );
}
