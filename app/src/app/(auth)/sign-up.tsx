import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOldEnough } from '@/domain/scoring';
import { useAuth } from '@/lib/auth';
import { LegalLinks } from '@/lib/LegalLinks';
import { Button, Chip, colors, Field, s } from '@/lib/ui';

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'self_described', label: 'Self-described' },
];

export default function SignUp() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [experience, setExperience] = useState('');
  const [ageOk, setAgeOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const by = Number(birthYear);
  const yearValid = /^\d{4}$/.test(birthYear) && by >= 1900 && by <= new Date().getFullYear();
  const canSubmit = !!email && password.length >= 8 && !!name.trim() && yearValid && ageOk && !busy;

  async function submit() {
    if (!isOldEnough(by)) {
      setError('You must be at least 13 to use Discores.');
      return;
    }
    setBusy(true);
    setError(null);
    const err = await signUp({
      email: email.trim(),
      password,
      displayName: name.trim(),
      birthYear: by,
      gender,
      experienceYears: experience ? Number(experience) : null,
    });
    setBusy(false);
    if (err) setError(err);
    else setNotice('Check your email to confirm your account, then sign in.'); // shown only if email confirmation is on
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        We only ask for your birth year (not full birthday). Gender, experience and location are optional and are used
        for leaderboard brackets.
      </Text>
      <Field label="Display name" value={name} onChangeText={setName} maxLength={40} />
      <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label="Password (8+ characters)" value={password} onChangeText={setPassword} secureTextEntry />
      <Field label="Birth year" value={birthYear} onChangeText={setBirthYear} keyboardType="number-pad" maxLength={4}
        placeholder="e.g. 1992" />
      <Field label="Years playing disc golf (optional)" value={experience}
        onChangeText={(t) => setExperience(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />

      <Text style={[s.label, { marginTop: 8 }]}>Gender (optional)</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {GENDERS.map((g) => (
          <Chip key={g.value} label={g.label} selected={gender === g.value}
            onPress={() => setGender(gender === g.value ? null : g.value)} />
        ))}
      </View>

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
      {notice && <Text style={s.body}>{notice}</Text>}
      <Button title={busy ? 'Creating…' : 'Create account'} onPress={submit} disabled={!canSubmit} />
      <LegalLinks lead="By creating an account you agree to the" />
    </ScrollView>
  );
}
