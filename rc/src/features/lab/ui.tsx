import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';

import { routeHex } from '@/lib/route-colors';

import { LabIcon } from './icons';
import type { LabTheme } from './variants';

type Kind = 'display' | 'title' | 'label' | 'body' | 'caption';

/** Themed text. Every variant maps the same five roles to its own type. */
export function T({
  t,
  kind = 'body',
  dim,
  style,
  children,
  numberOfLines,
}: {
  t: LabTheme;
  kind?: Kind;
  dim?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[kindStyle(t, kind), { color: dim ? t.c.dim : t.c.text }, style]}
    >
      {children}
    </Text>
  );
}

export function kindStyle(t: LabTheme, kind: Kind): TextStyle {
  switch (kind) {
    case 'display':
      return { fontFamily: t.font.number, fontWeight: t.font.numberWeight, fontSize: 44, letterSpacing: -0.5 };
    case 'title':
      return { fontFamily: t.font.display, fontWeight: '600', fontSize: 20 };
    case 'label':
      return { fontFamily: t.font.body, fontWeight: '600', fontSize: 15 };
    case 'caption':
      return { fontFamily: t.font.body, fontWeight: '500', fontSize: 13 };
    default:
      return { fontFamily: t.font.body, fontWeight: '400', fontSize: 15 };
  }
}

/** Route swatch — always shown next to the route's name (never color alone). */
export function Swatch({ color, size = 14, t }: { color: string; size?: number; t: LabTheme }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: routeHex(color),
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.25)',
      }}
    />
  );
}

/** "Walls >" section heading, like the reference's "Tokens >". */
export function SectionHead({ t, title }: { t: LabTheme; title: string }) {
  return (
    <View style={styles.head}>
      <T t={t} kind="title">
        {title}
      </T>
      <LabIcon name="chevron" size={16} color={t.c.dim} weight={2.4} />
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 22, marginBottom: 10 },
});
