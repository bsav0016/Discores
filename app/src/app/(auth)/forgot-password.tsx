import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useAuth } from '@/lib/auth';
import { Button, Field, s } from '@/lib/ui';

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    const err = await requestPasswordReset(email);
    setBusy(false);
    if (err) setError(err);
    else setSent(true);
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        Enter the email you signed up with and we'll send a link to choose a new password. Open the link on this phone.
      </Text>
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" onSubmitEditing={submit} returnKeyType="send" />
      {error && <Text style={s.error}>{error}</Text>}
      {sent && (
        // Same message whether or not the address has an account, so this can't be used to find out who has one.
        <Text style={s.body}>
          If that email has an account, a reset link is on its way. It can take a few minutes, so check your spam folder too.
        </Text>
      )}
      <Button title={busy ? 'Sending…' : sent ? 'Send it again' : 'Send reset link'} onPress={submit}
        disabled={busy || !email.includes('@')} />
    </ScrollView>
  );
}
