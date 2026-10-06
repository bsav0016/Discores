import { Stack } from 'expo-router';
import { colors } from '@/lib/ui';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brandDark,
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: '800' },
        contentStyle: { backgroundColor: colors.bg },
      }}>
      <Stack.Screen name="sign-in" options={{ headerShown: false }} />
      <Stack.Screen name="sign-up" options={{ title: 'Create account' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
    </Stack>
  );
}
