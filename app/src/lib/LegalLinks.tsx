import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { colors, s } from './ui';

/** "By ... you agree to the Terms of Service and Privacy Policy", with both documents one tap away. */
export function LegalLinks({ lead = 'By continuing you agree to the' }: { lead?: string }) {
  const router = useRouter();
  const open = (doc: 'terms' | 'privacy') => router.push({ pathname: '/legal/[doc]', params: { doc } });
  const link = { color: colors.brandDark, fontWeight: '700' as const, textDecorationLine: 'underline' as const };
  return (
    <Text style={[s.muted, { fontSize: 12, textAlign: 'center' }]}>
      {lead}{' '}
      <Text style={link} onPress={() => open('terms')}>Terms of Service</Text>
      {' and '}
      <Text style={link} onPress={() => open('privacy')}>Privacy Policy</Text>.
    </Text>
  );
}
