import { Pressable, Text, View } from 'react-native';
import { Card, colors, radius, s } from '@/lib/ui';

const PARS = [2, 3, 4, 5, 6];

/** One row per hole with par chips. Used when adding a course and when a reviewer fixes one. */
export function ParGrid({ pars, onChange }: { pars: number[]; onChange: (pars: number[]) => void }) {
  return (
    <Card style={{ gap: 10 }}>
      {pars.map((p, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[s.body, { fontWeight: '600', width: 70 }]}>Hole {i + 1}</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {PARS.map((v) => (
              <Pressable key={v} onPress={() => onChange(pars.map((x, j) => (j === i ? v : x)))}
                accessibilityLabel={`Hole ${i + 1} par ${v}`}
                style={{
                  width: 42, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: p === v ? colors.brand : colors.bg,
                }}>
                <Text style={{ color: p === v ? '#fff' : colors.ink, fontWeight: '700', fontSize: 16 }}>{v}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </Card>
  );
}
