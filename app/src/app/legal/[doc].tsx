import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { LEGAL } from '@/lib/legal.generated';
import { colors, s } from '@/lib/ui';

type Block = { kind: 'h1' | 'h2' | 'p' | 'li'; text: string };

/** Just enough markdown for the legal documents: # and ## headings, "- " bullets, paragraphs, **bold**. */
function parse(md: string): Block[] {
  return md.split(/\r?\n/).flatMap<Block>((line) => {
    const t = line.trim();
    if (!t) return [];
    if (t.startsWith('## ')) return [{ kind: 'h2', text: t.slice(3) }];
    if (t.startsWith('# ')) return [{ kind: 'h1', text: t.slice(2) }];
    if (t.startsWith('- ')) return [{ kind: 'li', text: t.slice(2) }];
    return [{ kind: 'p', text: t }];
  });
}

/** Renders **bold** runs inside a line. */
function Inline({ text, style }: { text: string; style: object }) {
  return (
    <Text style={style}>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith('**') ? <Text key={i} style={{ fontWeight: '800' }}>{part.slice(2, -2)}</Text> : part)}
    </Text>
  );
}

export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = doc === 'terms' ? 'terms' : 'privacy';
  const blocks = parse(LEGAL[key]);
  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.pad, { paddingBottom: 48 }]}>
      <Stack.Screen options={{ title: key === 'terms' ? 'Terms of Service' : 'Privacy Policy' }} />
      {blocks.map((b, i) =>
        b.kind === 'h1' ? <Text key={i} style={s.h1}>{b.text}</Text>
        : b.kind === 'h2' ? <Text key={i} style={[s.h2, { marginTop: 14 }]}>{b.text}</Text>
        : b.kind === 'li' ? (
          <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 4 }}>
            <Text style={s.body}>{'•'}</Text>
            <View style={{ flex: 1 }}><Inline text={b.text} style={s.body} /></View>
          </View>
        ) : <Inline key={i} text={b.text} style={[s.body, { color: colors.ink }]} />)}
    </ScrollView>
  );
}
