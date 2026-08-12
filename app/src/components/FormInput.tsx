import React, { useMemo } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radii, spacing, typography, fonts } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

interface Props extends TextInputProps {
  label: string;
  error?: string | null;
  helper?: string;
  ref?: React.Ref<TextInput>;
}

/** Forwards its ref to the inner `TextInput` so a screen can move focus between fields. */
export function FormInput({ label, error, helper, style, ref, ...rest }: Props): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: { marginBottom: spacing[4] },
        label: {
          fontFamily: fonts.sansBold,
          fontSize: typography.callout.size,
          fontWeight: '700',
          color: colors.textSecondary,
          marginBottom: spacing[1.5],
        },
        input: {
          borderWidth: 1,
          borderColor: colors.gray200,
          borderRadius: radii.md,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[3],
          fontFamily: fonts.sans,
          fontSize: typography.body.size,
          color: colors.textPrimary,
          backgroundColor: colors.surfaceContainerLowest,
        },
        inputError: { borderColor: colors.danger500 },
        error: { color: colors.danger500, fontFamily: fonts.sansMedium, fontSize: typography.callout.size, marginTop: spacing[1.5] },
        helper: { color: colors.gray500, fontFamily: fonts.sansMedium, fontSize: typography.callout.size, marginTop: spacing[1.5] },
      }),
    [colors],
  );
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={ref}
        style={[styles.input, error ? styles.inputError : null, style]}
        placeholderTextColor={colors.gray400}
        {...rest}
      />
      {error ? <Text style={styles.error}>{error}</Text> : helper ? <Text style={styles.helper}>{helper}</Text> : null}
    </View>
  );
}
