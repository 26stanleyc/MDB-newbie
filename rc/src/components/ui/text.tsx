import { Text as RNText, type TextProps } from 'react-native';

import { TextStyles, useThemeColors } from '@/theme';

type Variant = keyof typeof TextStyles;
type Tone = 'default' | 'secondary' | 'accent' | 'onAccent' | 'destructive';

type Props = TextProps & {
  variant?: Variant;
  tone?: Tone;
  /** Raw color override; wins over `tone`. */
  color?: string;
};

export function Text({
  variant = 'body',
  tone = 'default',
  color,
  style,
  ...rest
}: Props) {
  const c = useThemeColors();
  const toneColor =
    tone === 'secondary'
      ? c.textSecondary
      : tone === 'accent'
        ? c.accent
        : tone === 'onAccent'
          ? c.onAccent
          : tone === 'destructive'
            ? c.destructive
            : c.text;
  return <RNText style={[TextStyles[variant], { color: color ?? toneColor }, style]} {...rest} />;
}
