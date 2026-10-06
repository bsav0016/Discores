import { useState, type ReactNode } from 'react';
import {
  Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle,
} from 'react-native';

export const colors = {
  bg: '#f3f5ef',
  card: '#ffffff',
  ink: '#14201a',
  muted: '#667064',
  brand: '#1b7f4b',
  brandDark: '#125c36',
  brandSoft: '#e1f1e7',
  accent: '#f2a93b',
  danger: '#b3261e',
  dangerSoft: '#fbe9e7',
  line: '#dfe4da',
};

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 };

const shadow: ViewStyle = {
  shadowColor: '#0d2417', shadowOpacity: 0.07, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2,
};

export function Button({
  title, onPress, variant = 'primary', disabled, style,
}: {
  title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'soft'; disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        variant === 'primary' && { backgroundColor: colors.brand },
        variant === 'danger' && { backgroundColor: colors.danger },
        variant === 'soft' && { backgroundColor: colors.brandSoft },
        variant === 'ghost' && { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.line },
        pressed && { transform: [{ scale: 0.98 }], opacity: 0.9 },
        disabled && { opacity: 0.4 },
        style,
      ]}>
      <Text style={[s.btnText, (variant === 'ghost') && { color: colors.ink }, variant === 'soft' && { color: colors.brandDark }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, onFocus, onBlur, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        style={[s.input, focused && { borderColor: colors.brand, backgroundColor: '#fff' }, style]}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); onBlur?.(e); }}
        {...rest}
      />
    </View>
  );
}

export function Card({ children, style, onPress, selected }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; selected?: boolean;
}) {
  const base = [s.card, selected && { borderColor: colors.brand, backgroundColor: colors.brandSoft }, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [base, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: !!selected }}
      style={[s.chip, selected && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
      <Text style={{ color: selected ? '#fff' : colors.ink, fontWeight: '600', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' }) {
  const bg = tone === 'good' ? colors.brandSoft : tone === 'warn' ? '#fdf0d8' : '#eceee8';
  const fg = tone === 'good' ? colors.brandDark : tone === 'warn' ? '#8a5a00' : colors.muted;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <Text style={s.section}>{children}</Text>;
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 10, paddingBottom: 40 },
  h1: { fontSize: 30, fontWeight: '800', color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 19, fontWeight: '700', color: colors.ink },
  body: { fontSize: 16, color: colors.ink },
  muted: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, backgroundColor: colors.dangerSoft, padding: 10, borderRadius: radius.sm },
  label: { fontSize: 13, fontWeight: '700', color: colors.muted },
  section: {
    fontSize: 12, fontWeight: '800', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.8,
    marginTop: 14, marginBottom: 2,
  },
  input: {
    borderWidth: 1.5, borderColor: colors.line, backgroundColor: '#fbfcfa', borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, color: colors.ink,
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1.5,
    borderColor: 'transparent', gap: 4, ...shadow,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  btn: { paddingVertical: 15, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
