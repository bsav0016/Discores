import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text } from 'react-native';
import { useAuth } from '@/lib/auth';
import { passwordProblem } from '@/lib/recovery';
import { Button, Field, s } from '@/lib/ui';

export default function ChangePassword() {
  const { changePassword } = useAuth();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const problem = passwordProblem(next, confirm);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const err = await changePassword(current, next);
    setBusy(false);
    if (err) return setError(err);
    Alert.alert('Password changed', 'Your other devices have been signed out.');
    router.back();
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Field label="Current password" value={current} onChangeText={setCurrent} secureTextEntry
        autoComplete="current-password" />
      <Field label="New password (8+ characters)" value={next} onChangeText={setNext} secureTextEntry
        autoComplete="new-password" />
      <Field label="Type the new one again" value={confirm} onChangeText={setConfirm} secureTextEntry
        autoComplete="new-password" onSubmitEditing={submit} returnKeyType="done" />
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Change password'} onPress={submit}
        disabled={busy || !current || !next || !confirm} />
    </ScrollView>
  );
}
