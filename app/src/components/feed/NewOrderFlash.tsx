import React, { useEffect } from 'react';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

const PULSES = 5;
const PULSE_MS = 380;

/**
 * Pulsing highlight behind an order card that just arrived from another device. It flashes
 * a handful of times so the card is unmissable, then calls `onDone` so the caller can clear
 * the order from the new-arrivals set and the card settles back to normal.
 */
export function NewOrderFlash({
  active,
  onDone,
  children,
}: {
  active: boolean;
  onDone: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (!active) return;
    progress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: PULSE_MS }),
        withTiming(0, { duration: PULSE_MS }),
      ),
      PULSES,
      false,
      (finished) => {
        if (finished === true) runOnJS(onDone)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const style = useAnimatedStyle(() => ({
    backgroundColor: `rgba(255, 179, 0, ${0.35 * progress.value})`,
    borderRadius: 18,
  }));

  if (!active) return <>{children}</>;
  return <Animated.View style={style}>{children}</Animated.View>;
}
