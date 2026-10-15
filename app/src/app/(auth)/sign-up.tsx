import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { isOldEnough } from '@/domain/scoring';
import { useAuth } from '@/lib/auth';
import { checkDisplayName, defaultDisplayName } from '@/lib/displayName';
import { LegalLinks } from '@/lib/LegalLinks';
import { Button, Chip, colors, Field, s } from '@/lib/ui';

const GENDERS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'nonbinary', label: 'Non-binary' },
  { value: 'self_described', label: 'Self-described' },
];

export default function SignUp() {
  const { signUp, resendConfirmation } = useAuth();
  const router = useRouter();
  const [sentTo, setSentTo] = useState<string | null>(null);
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
  const canSubmit = !!email && password.length >= 8 && yearValid && ageOk && !busy;

  async function submit() {
    if (!isOldEnough(by)) {
      setError('You must be at least 13 to use Discores.');
      return;
    }
    const typed = checkDisplayName(name);
    if (name.trim() && 'error' in typed) {
      setError(typed.error);
      return;
    }
    setBusy(true);
    setError(null);
    const err = await signUp({
      email: email.trim(),
      password,
      // Left blank, they are called the start of their email address; they can change it in Settings.
      displayName: 'name' in typed ? typed.name : defaultDisplayName(email.trim()),
      birthYear: by,
      gender,
      experienceYears: experience ? Number(experience) : null,
    });
    setBusy(false);
    // With email confirmation on there is no session yet, so this screen stays and asks them to check their inbox.
    // (If confirmation is off the app signs them in and leaves this screen on its own.)
    if (err) setError(err);
    else setSentTo(email.trim());
  }

  async function resend() {
    setBusy(true);
    const err = await resendConfirmation(email);
    setBusy(false);
    setNotice(err ?? 'Sent again. It can take a few minutes, so check your spam folder too.');
  }

  if (sentTo) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={[s.pad, { alignItems: 'center', paddingTop: 48 }]}>
        <View style={{
          width: 76, height: 76, borderRadius: 38, backgroundColor: colors.brandSoft, alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Ionicons name="mail-outline" size={40} color={colors.brandDark} />
        </View>
        <Text style={[s.h1, { textAlign: 'center' }]} accessibilityRole="header">Check your email</Text>
        <Text style={[s.body, { textAlign: 'center' }]}>We sent a confirmation link to</Text>
        <Text style={[s.body, { textAlign: 'center', fontWeight: '800' }]}>{sentTo}</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>
          Open the link on this phone to finish creating your account. Until you do, you can't sign in. It can take a few
          minutes, so check your spam folder too.
        </Text>
        {notice && <Text style={[s.body, { textAlign: 'center' }]}>{notice}</Text>}
        <Button title={busy ? 'Sending…' : 'Send it again'} variant="soft" onPress={resend} disabled={busy}
          style={{ alignSelf: 'stretch' }} />
        <Button title="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')}
          style={{ alignSelf: 'stretch', marginTop: 0 }} />
        <Text style={[s.muted, { textAlign: 'center', fontSize: 12 }]}>
          Typed the wrong email? Go back and create the account again with the right one.
        </Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets style={s.screen} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>
        We only ask for your birth year, not your full birthday. Gender and years playing are optional. Other players
        never see your birth year or gender.
      </Text>
      <Field label="Display name (optional)" value={name} onChangeText={setName} maxLength={40}
        placeholder="Friends see this. Defaults to your email name."
        autoComplete="off" importantForAutofill="no" textContentType="none" autoCorrect={false} />
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
      <Button title={busy ? 'Creating…' : 'Create account'} onPress={submit} disabled={!canSubmit} />
      <LegalLinks lead="By creating an account you agree to the" />
    </ScrollView>
  );
}
