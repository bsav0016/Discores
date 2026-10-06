import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useAuth } from './auth';
import { passwordProblem } from './recovery';
import { Button, Field, s } from './ui';

/** Shown instead of the app after someone opens the link from a password-reset email. */
export function ResetPasswordScreen() {
  const { finishRecovery, cancelRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const problem = passwordProblem(password, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const err = await finishRecovery(password); // on success the app opens, signed in
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 72 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>Choose a new password</Text>
      <Text style={s.muted}>
        Pick something you don't use anywhere else. You'll be signed out on other devices.
      </Text>
      <Field label="New password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry
        autoComplete="new-password" />
      <Field label="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password"
        onSubmitEditing={submit} returnKeyType="done" />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Save password'} onPress={submit} disabled={busy || !password || !confirm} />
      <Button title="Cancel" variant="ghost" onPress={cancelRecovery} style={{ marginTop: 0 }} />
    </ScrollView>
  );
}
