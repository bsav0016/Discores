import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOldEnough } from '@/domain/scoring';
import { useAuth } from '@/lib/auth';
import { LegalLinks } from '@/lib/LegalLinks';
import { Button, colors, Field, s } from '@/lib/ui';

/** Shown once after the first Apple/Google sign-in: the same name and age check email sign-up asks for. */
export default function CompleteProfile() {
  const { session, completeProfile, signOut } = useAuth();
  const meta = session?.user.user_metadata ?? {};
  const [name, setName] = useState(String(meta.display_name ?? meta.full_name ?? meta.name ?? ''));
  const [birthYear, setBirthYear] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const by = Number(birthYear);
  const yearValid = /^\d{4}$/.test(birthYear) && by >= 1900 && by <= new Date().getFullYear();
  const canSubmit = !!name.trim() && yearValid && ageOk && !busy;

  async function submit() {
    if (!isOldEnough(by)) {
      setError('You must be at least 13 to use Discores.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await completeProfile(name.trim(), by, ageOk);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingTop: 72 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.h1}>One last step</Text>
      <Text style={s.muted}>
        Choose the name friends will see and confirm your age. We only ask for your birth year, not your full birthday.
      </Text>
      <Field label="Display name" value={name} onChangeText={setName} maxLength={40} />
      <Field label="Birth year" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" maxLength={4}
        placeholder="e.g. 1992" />
      <Pressable onPress={() => setAgeOk(!ageOk)} accessibilityRole="checkbox" accessibilityState={{ checked: ageOk }}
        style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 16 }}>
        <View style={{
          width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: colors.brand, alignItems: 'center',
          justifyContent: 'center', backgroundColor: ageOk ? colors.brand : 'transparent',
        }}>
          {ageOk && <Ionicons name="checkmark" size={18} color="#fff" />}
        </View>
        <Text style={[s.body, { flex: 1 }]}>I am 13 years old or older.</Text>
      </Pressable>
      {error && <Text style={s.error}>{error}</Text>}
      <Button title={busy ? 'Saving…' : 'Continue'} onPress={submit} disabled={!canSubmit} />
      <LegalLinks lead="By continuing you agree to the" />
      <Button title="Cancel and sign out" variant="ghost" onPress={signOut} style={{ marginTop: 0 }} />
    </ScrollView>
  );
}
