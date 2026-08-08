import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { PressableScale } from '../PressableScale';
import { t, type Language } from '../../i18n';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * The bottom action bar.
 *
 * Task-oriented rather than conversational: "New Order" is a solid primary button on its own
 * row, because raising an order is the point of the board and should never be buried behind
 * an attachment menu. Typing, voice and attachments sit on the row below, secondary to it.
 *
 * While recording, the input row is replaced entirely by a timer and a stop control — there
 * is nothing else worth doing mid-recording, and leaving the other affordances live invites
 * a mis-tap that loses the take.
 */
export function ComposeBar({
  language = 'en',
  canPost,
  canCreateOrder,
  isRecording,
  recordingMs,
  recordingLevel,
  onSend,
  onNewOrder,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  onAttach,
}: {
  language?: Language;
  canPost: boolean;
  canCreateOrder: boolean;
  isRecording: boolean;
  recordingMs: number;
  /** 0–1 microphone level, for the pulse. */
  recordingLevel: number;
  onSend: (text: string) => void;
  onNewOrder: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  onAttach: () => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState('');

  const send = (): void => {
    const text = draft.trim();
    if (text === '') return;
    onSend(text);
    setDraft('');
  };

  if (isRecording) {
    return (
      <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)} style={styles.bar}>
        <View style={styles.recordingRow}>
          <PressableScale onPress={onCancelRecording}>
            <View style={styles.cancelButton}>
              <Ionicons name="close" size={18} color={colors.error} />
            </View>
          </PressableScale>

          <View style={styles.recordingMeter}>
            <View
              style={[
                styles.recordingDot,
                // Scales with input level so the user can see the microphone is live.
                { transform: [{ scale: 1 + recordingLevel * 0.6 }] },
              ]}
            />
            <Text style={styles.recordingLabel}>{t('recording', language)}</Text>
            <Text style={styles.recordingTime}>{formatDuration(recordingMs)}</Text>
          </View>

          <PressableScale onPress={onStopRecording}>
            <View style={styles.stopButton}>
              <Ionicons name="stop" size={18} color={colors.onPrimary} />
            </View>
          </PressableScale>
        </View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.bar}>
      {canCreateOrder ? (
        <View style={styles.actionRow}>
          <PressableScale onPress={onNewOrder}>
            <View style={styles.newOrderButton}>
              <Ionicons name="add" size={16} color={colors.onPrimary} />
              <Text style={styles.newOrderLabel}>{t('newOrder', language)}</Text>
            </View>
          </PressableScale>
        </View>
      ) : null}

      {canPost ? (
        <View style={styles.inputRow}>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={t('typeMessage', language)}
              placeholderTextColor={colors.outline}
              multiline
              maxLength={4000}
            />
            <PressableScale onPress={onStartRecording}>
              <Ionicons name="mic-outline" size={20} color={colors.outline} />
            </PressableScale>
            <PressableScale onPress={onAttach}>
              <Ionicons name="attach-outline" size={20} color={colors.outline} />
            </PressableScale>
          </View>

          <PressableScale onPress={send} disabled={draft.trim() === ''}>
            <View style={[styles.sendButton, draft.trim() === '' && styles.sendButtonIdle]}>
              <Ionicons name="send" size={16} color={colors.onPrimary} />
            </View>
          </PressableScale>
        </View>
      ) : (
        <Text style={styles.readOnly}>You have read-only access to this board.</Text>
      )}
    </View>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  bar: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing[2.5],
    // Generous bottom padding keeps the controls clear of the gesture area, per DESIGN.md.
    paddingBottom: spacing[6],
    gap: spacing[2],
  },
  actionRow: { flexDirection: 'row', gap: spacing[2] },
  newOrderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    height: 36,
    paddingHorizontal: spacing[4],
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  newOrderLabel: {
    color: colors.onPrimary,
    fontFamily: fonts.sansSemibold,
    fontSize: typography.bodyMd.size,
    fontWeight: '600',
  },

  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing[2] },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 40,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1.5],
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLow,
  },
  input: {
    flex: 1,
    maxHeight: 96,
    fontFamily: fonts.sans,
    fontSize: typography.bodyMd.size,
    color: colors.onSurface,
    padding: 0,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendButtonIdle: { backgroundColor: colors.outlineVariant },

  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  cancelButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorContainer,
  },
  recordingMeter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    height: 40,
    paddingHorizontal: spacing[4],
    borderRadius: radii.full,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
  recordingLabel: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.onSurfaceVariant,
  },
  recordingTime: {
    fontFamily: fonts.mono,
    fontSize: typography.dataMono.size,
    fontWeight: '700',
    color: colors.onSurface,
    fontVariant: ['tabular-nums'],
  },
  stopButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.error,
  },

  readOnly: {
    textAlign: 'center',
    fontFamily: fonts.sans,
    fontSize: typography.bodySm.size,
    color: colors.outline,
    paddingVertical: spacing[2],
  },
});
