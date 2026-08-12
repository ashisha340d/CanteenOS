import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, type PressableProps } from 'react-native';
import { PressableScale } from './PressableScale';
import { radii, spacing, typography, fonts } from '../theme/tokens';
import { useThemeColors } from '../theme/useThemeColors';

interface Props extends PressableProps {
  label: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
}

export function PrimaryButton({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  size = 'md',
  style: _ignoredStyle,
  ...rest
}: Props): React.JSX.Element {
  const { colors } = useThemeColors();
  const isDisabled = disabled || loading;
  const stylesByVariant = useMemo(
    () => ({
      primary: { container: { backgroundColor: colors.taskBar }, textColor: colors.white, loaderColor: colors.white },
      secondary: { container: { backgroundColor: colors.gray100 }, textColor: colors.textPrimary, loaderColor: colors.gray700 },
      danger: { container: { backgroundColor: colors.danger500 }, textColor: colors.white, loaderColor: colors.white },
      ghost: { container: { backgroundColor: 'transparent' }, textColor: colors.taskBar, loaderColor: colors.taskBar },
    }),
    [colors],
  );
  const variantStyle = stylesByVariant[variant];
  const sizeStyle = size === 'sm' ? styles.sizeSm : styles.sizeMd;

  return (
    <PressableScale
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, variantStyle.container, sizeStyle, isDisabled ? styles.disabled : null]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.loaderColor} size="small" />
      ) : (
        <Text style={[styles.label, { color: variantStyle.textColor }, size === 'sm' && styles.labelSm]}>
          {label}
        </Text>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  sizeMd: { paddingVertical: spacing[3], paddingHorizontal: spacing[5] },
  sizeSm: { paddingVertical: spacing[2], paddingHorizontal: spacing[4], minHeight: 36 },
  disabled: { opacity: 0.45 },
  label: {
    fontFamily: fonts.sansBold,
    fontSize: typography.body.size,
    fontWeight: '700',
    lineHeight: typography.body.lineHeight,
  },
  labelSm: {
    fontFamily: fonts.sansMedium,
    fontSize: typography.callout.size,
    lineHeight: typography.callout.lineHeight,
  },
});
