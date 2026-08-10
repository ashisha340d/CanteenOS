import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { wa } from '../../theme/whatsapp';

/**
 * The three-dot ripple WhatsApp shows while someone is composing.
 *
 * Each dot runs the same 1.2s cycle offset by 150ms, rising in opacity and lifting a couple of
 * pixels — the staggered wave, not three independently blinking dots.
 */
export function TypingDots({
  color = wa.bubbleMeta,
  size = 7,
}: {
  color?: string;
  size?: number;
}): React.JSX.Element {
  return (
    <View style={[styles.dots, { gap: size * 0.55 }]}>
      <Dot color={color} size={size} delay={0} />
      <Dot color={color} size={size} delay={150} />
      <Dot color={color} size={size} delay={300} />
    </View>
  );
}

function Dot({
  color,
  size,
  delay,
}: {
  color: string;
  size: number;
  delay: number;
}): React.JSX.Element {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 400, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 400, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 400 }),
        ),
        -1,
        false,
      ),
    );
  }, [delay, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [0.35, 1]),
    transform: [{ translateY: interpolate(progress.value, [0, 1], [0, -size * 0.42]) }],
  }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        animatedStyle,
      ]}
    />
  );
}

/** The typing bubble that sits at the foot of the conversation, shaped like an incoming message. */
export function TypingBubble(): React.JSX.Element {
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={styles.bubbleRow}
    >
      <View style={styles.tailBorder} />
      <View style={styles.bubble}>
        <TypingDots />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', alignItems: 'center' },

  bubbleRow: { alignSelf: 'flex-start', flexDirection: 'row', marginLeft: 8, marginBottom: 8 },
  tailBorder: {
    position: 'absolute',
    top: 0,
    left: -6,
    width: 0,
    height: 0,
    borderTopWidth: 0,
    borderBottomWidth: 10,
    borderBottomColor: 'transparent',
    borderRightWidth: 8,
    borderRightColor: wa.bubbleIn,
  },
  bubble: {
    backgroundColor: wa.bubbleIn,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 7.5,
    borderBottomLeftRadius: 7.5,
    borderBottomRightRadius: 7.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 1,
    shadowColor: '#0B141A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.13,
    shadowRadius: 0.5,
  },
});
