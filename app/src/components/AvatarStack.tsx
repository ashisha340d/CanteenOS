import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../theme/tokens';

interface Props {
  names: string[];
  max?: number;
  size?: 'sm' | 'md';
}

/**
 * Compact overlapping avatar bubbles, used on order cards and detail headers to show
 * participants at a glance.
 */
export function AvatarStack({ names, max = 3, size = 'sm' }: Props): React.JSX.Element {
  const visible = names.slice(0, max);
  const remaining = names.length - max;
  const sizeValue = size === 'sm' ? 26 : 34;
  const fontSize = size === 'sm' ? typography.footnote.size : typography.caption.size;

  return (
    <View style={styles.container}>
      {visible.map((name, i) => (
        <View
          key={`${name}-${i}`}
          style={[
            styles.bubble,
            {
              width: sizeValue,
              height: sizeValue,
              borderRadius: sizeValue / 2,
              marginLeft: i === 0 ? 0 : -sizeValue * 0.3,
              zIndex: visible.length - i,
            },
          ]}
        >
          <Text style={[styles.initial, { fontSize }]}>{initial(name)}</Text>
        </View>
      ))}
      {remaining > 0 ? (
        <View
          style={[
            styles.bubble,
            styles.moreBubble,
            {
              width: sizeValue,
              height: sizeValue,
              borderRadius: sizeValue / 2,
              marginLeft: -sizeValue * 0.3,
            },
          ]}
        >
          <Text style={[styles.initial, { fontSize }]}>+{remaining}</Text>
        </View>
      ) : null}
    </View>
  );
}

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  bubble: {
    backgroundColor: colors.primary100,
    borderWidth: 2,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBubble: { backgroundColor: colors.gray200 },
  initial: { fontWeight: '800', color: colors.primary700 },
});
