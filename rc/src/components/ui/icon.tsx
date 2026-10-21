import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { useThemeColors } from '@/theme';

type Props = {
  name: SymbolViewProps['name'];
  size?: number;
  /** Theme color token, or a raw hex. Defaults to primary text color. */
  color?: string;
};

/** SF Symbol wrapper (no emoji-as-icons, per MASTER.md). iOS-first. */
export function Icon({ name, size = 22, color }: Props) {
  const c = useThemeColors();
  return (
    <SymbolView
      name={name}
      size={size}
      tintColor={color ?? c.text}
      resizeMode="scaleAspectFit"
    />
  );
}
