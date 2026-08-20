import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ThemedBottomSheet } from '../BottomSheet';
import { PrimaryButton } from '../PrimaryButton';
import { radii, spacing, typography } from '../../theme/tokens';
import { useThemeColors } from '../../theme/useThemeColors';
import type { ColorPalette } from '../../theme/tokens';

/**
 * Asking for a written reason.
 *
 * Exists because `Alert.prompt` is iOS-only: on Android it is simply absent, so a skip button
 * wired to it does nothing at all — and since the server refuses to complete a task while a
 * mandatory step is pending, that silently makes the job unfinishable. A sheet with a real
 * text field works on both platforms and gives the reason the room it deserves, since it ends
 * up in a hygiene record somebody may have to defend.
 */
export function ReasonSheet({
  isOpen,
  title,
  subtitle,
  placeholder,
  confirmLabel = 'Save',
  maxLength,
  busy,
  onConfirm,
  onClose,
}: {
  isOpen: boolean;
  title: string;
  /** What the reason is about — the step's own name, the task being cancelled. */
  subtitle?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength: number;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { colors } = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [reason, setReason] = useState('');

  // Cleared on every open so a reason typed for one step never leaks onto the next.
  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  const ready = reason.trim() !== '';

  return (
    <ThemedBottomSheet isOpen={isOpen} onClose={onClose} title={title}>
      <View style={styles.body}>
        {subtitle !== undefined ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder={placeholder ?? 'Say why'}
          placeholderTextColor={colors.onSurfaceVariant}
          value={reason}
          onChangeText={setReason}
          multiline
          autoFocus
          maxLength={maxLength}
        />
        <PrimaryButton
          label={confirmLabel}
          loading={busy}
          disabled={!ready}
          onPress={() => onConfirm(reason.trim())}
        />
      </View>
    </ThemedBottomSheet>
  );
}

function createStyles(colors: ColorPalette) {
  return StyleSheet.create({
    body: { gap: spacing[3], paddingBottom: spacing[4] },
    subtitle: {
      fontFamily: typography.bodySm.fontFamily,
      fontSize: typography.bodySm.size,
      color: colors.onSurfaceVariant,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.outlineVariant,
      borderRadius: radii.lg,
      padding: spacing[3],
      minHeight: 96,
      textAlignVertical: 'top',
      fontFamily: typography.bodyMd.fontFamily,
      fontSize: typography.bodyMd.size,
      color: colors.onSurface,
      backgroundColor: colors.surfaceContainerLow,
    },
  });
}
