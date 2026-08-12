import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from './PressableScale';
import { fonts, radii, spacing } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

interface PinPadProps {
  value: string;
  length?: number;
  onChange: (next: string) => void;
  disabled?: boolean;
}

/** On-screen numeric keypad for PIN entry — no system keyboard, dots show progress. */
export function PinPad({ value, length = 4, onChange, disabled }: PinPadProps): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const onKeyPress = (key: string): void => {
    if (disabled) return;
    if (key === 'back') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '' || value.length >= length) return;
    onChange(value + key);
  };

  return (
    <View>
      <View style={styles.dots}>
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={[styles.dot, i < value.length && styles.dotFilled]} />
        ))}
      </View>

      <View style={styles.keypad}>
        {KEYS.map((key, i) => (
          <PressableScale
            key={`${key}-${i}`}
            style={styles.keyWrap}
            disabled={disabled || key === ''}
            onPress={() => onKeyPress(key)}
          >
            <View style={styles.key}>
              {key === 'back' ? (
                <Ionicons name="backspace-outline" size={22} color={colors.textPrimary} />
              ) : (
                <Text style={styles.keyLabel}>{key}</Text>
              )}
            </View>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useThemeColors>['colors']) {
  return StyleSheet.create({
    dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing[4], marginBottom: spacing[4] },
    dot: {
      width: 16,
      height: 16,
      borderRadius: radii.full,
      borderWidth: 2,
      borderColor: colors.gray300,
    },
    dotFilled: { backgroundColor: colors.taskBar, borderColor: colors.taskBar },
    keypad: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      width: 280,
      alignSelf: 'center',
      justifyContent: 'center',
    },
    keyWrap: { width: '33.33%', alignItems: 'center', marginBottom: spacing[3] },
    key: {
      width: 68,
      height: 68,
      borderRadius: radii.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceContainer,
    },
    keyLabel: { fontFamily: fonts.sansSemibold, fontSize: 24, color: colors.textPrimary },
  });
}
