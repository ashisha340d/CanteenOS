import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PressableScale } from '../PressableScale';
import { t, type Language } from '../../i18n';
import { wa } from '../../theme/whatsapp';
import { motion } from '../../theme/tokens';

/**
 * WhatsApp's composer: a white rounded pill carrying the emoji button, the text field and the
 * attachment/camera actions, with a single circular green button beside it that morphs between
 * microphone and send as the draft fills.
 *
 * "New Order" replaces the camera slot — it is this product's equivalent of the one structured
 * thing you can post besides a message, and it belongs on the same row rather than above it.
 *
 * While recording, the pill is replaced by the blinking red dot, the running timer and the
 * "slide to cancel" affordance, exactly as the real client does.
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
  onTypingChange,
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
  /** Fired as the draft goes from empty to non-empty and back, for the typing indicator. */
  onTypingChange?: (typing: boolean) => void;
}): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const hasDraft = draft.trim() !== '';

  useEffect(() => {
    onTypingChange?.(hasDraft);
  }, [hasDraft, onTypingChange]);

  const send = (): void => {
    const text = draft.trim();
    if (text === '') return;
    onSend(text);
    setDraft('');
  };

  const bottom = Math.max(insets.bottom, 6);

  if (isRecording) {
    return (
      <View style={[styles.bar, { paddingBottom: bottom }]}>
        <Animated.View
          entering={FadeIn.duration(140)}
          exiting={FadeOut.duration(140)}
          style={styles.recordingRow}
        >
          <View style={styles.recordingPill}>
            <BlinkingDot />
            <Text style={styles.recordingTime}>{formatDuration(recordingMs)}</Text>
            <PressableScale onPress={onCancelRecording} style={styles.slideToCancel} hitSlop={8}>
              <Ionicons name="chevron-back" size={15} color={wa.recordText} />
              <Text style={styles.slideToCancelText}>
                {language === 'hi' ? 'रद्द करने के लिए स्लाइड करें' : 'Slide to cancel'}
              </Text>
            </PressableScale>
          </View>

          <MicPulse level={recordingLevel}>
            <PressableScale onPress={onStopRecording} style={styles.actionButton}>
              <Ionicons name="send" size={21} color="#FFFFFF" />
            </PressableScale>
          </MicPulse>
        </Animated.View>
      </View>
    );
  }

  if (!canPost && !canCreateOrder) {
    return (
      <View style={[styles.bar, { paddingBottom: bottom }]}>
        <View style={styles.readOnlyPill}>
          <Ionicons name="lock-closed" size={12} color={wa.systemPillText} />
          <Text style={styles.readOnly}>
            {language === 'hi'
              ? 'आपके पास इस बोर्ड पर केवल देखने की अनुमति है'
              : 'You have read-only access to this board'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.bar, { paddingBottom: bottom }]}>
      <View style={styles.row}>
        <View style={styles.inputPill}>
          <PressableScale onPress={onNewOrder} hitSlop={6} style={styles.pillIcon} disabled={!canCreateOrder}>
            <Ionicons
              name="happy-outline"
              size={25}
              color={canCreateOrder ? wa.composeIcon : 'transparent'}
            />
          </PressableScale>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={canPost ? t('typeMessage', language) : 'Raise an order'}
            placeholderTextColor={wa.composePlaceholder}
            editable={canPost}
            multiline
            maxLength={4000}
            underlineColorAndroid="transparent"
          />

          {canPost ? (
            <PressableScale onPress={onAttach} hitSlop={6} style={styles.pillIcon}>
              <View style={styles.clip}>
                <Ionicons name="attach" size={24} color={wa.composeIcon} />
              </View>
            </PressableScale>
          ) : null}

          {canCreateOrder && !hasDraft ? (
            <PressableScale onPress={onNewOrder} hitSlop={6} style={styles.pillIcon}>
              <Ionicons name="add-circle-outline" size={25} color={wa.composeIcon} />
            </PressableScale>
          ) : null}
        </View>

        <PressableScale
          onPress={hasDraft ? send : canPost ? onStartRecording : onNewOrder}
          style={styles.actionButton}
        >
          <Animated.View key={hasDraft ? 'send' : 'mic'} entering={FadeIn.duration(120)}>
            <Ionicons
              name={hasDraft ? 'send' : canPost ? 'mic' : 'add'}
              size={hasDraft ? 20 : 24}
              color="#FFFFFF"
              style={hasDraft ? styles.sendGlyph : undefined}
            />
          </Animated.View>
        </PressableScale>
      </View>
    </View>
  );
}

/** The red dot that pulses once a second while the microphone is live. */
function BlinkingDot(): React.JSX.Element {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.15, { duration: 500, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.recordingDot, animatedStyle]} />;
}

/** A halo behind the send/stop button that swells with the microphone input level. */
function MicPulse({
  level,
  children,
}: {
  level: number;
  children: React.ReactNode;
}): React.JSX.Element {
  const amplitude = useSharedValue(0);

  useEffect(() => {
    amplitude.value = withSpring(level, motion.spring.snappy);
  }, [amplitude, level]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(amplitude.value, [0, 1], [1, 1.55]) }],
    opacity: interpolate(amplitude.value, [0, 1], [0, 0.28]),
  }));

  return (
    <View style={styles.micPulseWrap}>
      <Animated.View style={[styles.micHalo, haloStyle]} pointerEvents="none" />
      {children}
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
    backgroundColor: wa.composeBg,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },

  inputPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    maxHeight: 130,
    paddingHorizontal: 6,
    borderRadius: 24,
    backgroundColor: wa.composeInputBg,
    elevation: 1,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  pillIcon: { paddingHorizontal: 5, paddingVertical: 8 },
  clip: { transform: [{ rotate: '-40deg' }] },
  input: {
    flex: 1,
    maxHeight: 110,
    paddingHorizontal: 4,
    paddingVertical: 12,
    fontSize: 16.5,
    lineHeight: 21,
    color: wa.bubbleText,
  },

  actionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: wa.actionButton,
    elevation: 2,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  /* The paper-plane glyph is optically left-heavy; nudge it back to centre. */
  sendGlyph: { marginLeft: 2 },

  micPulseWrap: { alignItems: 'center', justifyContent: 'center' },
  micHalo: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: wa.actionButton,
  },

  recordingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recordingPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    height: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: wa.composeInputBg,
  },
  recordingDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: wa.recordDot },
  recordingTime: {
    fontSize: 15,
    color: wa.bubbleText,
    fontVariant: ['tabular-nums'],
    minWidth: 42,
  },
  slideToCancel: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  slideToCancelText: { fontSize: 14.5, color: wa.recordText },

  readOnlyPill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7.5,
    backgroundColor: wa.systemPillBg,
  },
  readOnly: { fontSize: 12.5, color: wa.systemPillText },
});
