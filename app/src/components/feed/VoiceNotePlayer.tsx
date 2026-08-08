import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { PressableScale } from '../PressableScale';
import { colors, radii, spacing, typography, fonts } from '../../theme/tokens';

/**
 * A voice note in the feed.
 *
 * The waveform is decorative — expo-av exposes no amplitude data for a recorded file — but
 * it is derived from the attachment id rather than randomised, so a given note always draws
 * the same shape. A bar chart that reshuffled on every render would read as a loading state.
 *
 * Bars fill with playback progress, which is the part that carries real information.
 */

const BAR_COUNT = 28;

export function VoiceNotePlayer({
  attachmentId,
  uri,
  durationMs,
  compact = false,
}: {
  attachmentId: string;
  uri: string | undefined;
  durationMs: number | null;
  compact?: boolean;
}): React.JSX.Element {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [rate, setRate] = useState<1 | 1.5 | 2>(1);
  const alive = useRef(true);

  const total = durationMs ?? 0;
  const progress = total > 0 ? Math.min(1, positionMs / total) : 0;
  const bars = useRef(buildWaveform(attachmentId)).current;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void sound?.unloadAsync();
    };
  }, [sound]);

  const onStatus = (status: AVPlaybackStatus): void => {
    if (!alive.current || !status.isLoaded) return;
    setPositionMs(status.positionMillis);
    setPlaying(status.isPlaying);
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
    }
  };

  const toggle = async (): Promise<void> => {
    if (uri === undefined) return;

    if (sound !== null) {
      const status = await sound.getStatusAsync();
      if (status.isLoaded && status.isPlaying) {
        await sound.pauseAsync();
      } else {
        await sound.playAsync();
      }
      return;
    }

    const { sound: created } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true, rate, shouldCorrectPitch: true },
      onStatus,
    );
    if (!alive.current) {
      await created.unloadAsync();
      return;
    }
    setSound(created);
  };

  const cycleRate = async (): Promise<void> => {
    const next: 1 | 1.5 | 2 = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1;
    setRate(next);
    await sound?.setRateAsync(next, true);
  };

  const unavailable = uri === undefined;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <PressableScale onPress={toggle} disabled={unavailable}>
        <View style={[styles.playButton, unavailable && styles.playButtonDisabled]}>
          <Ionicons
            name={unavailable ? 'cloud-download-outline' : playing ? 'pause' : 'play'}
            size={13}
            color={colors.onPrimary}
          />
        </View>
      </PressableScale>

      <View style={styles.waveform}>
        {bars.map((height, index) => {
          const played = index / BAR_COUNT <= progress;
          return (
            <View
              key={index}
              style={[
                styles.bar,
                { height: 4 + height * 12 },
                played ? styles.barPlayed : styles.barPending,
              ]}
            />
          );
        })}
      </View>

      <Text style={styles.time}>{formatDuration(playing ? positionMs : total)}</Text>

      {!compact ? (
        <PressableScale onPress={cycleRate} disabled={unavailable}>
          <View style={styles.rateChip}>
            <Text style={styles.rateText}>{rate}x</Text>
          </View>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * Deterministic pseudo-waveform from the attachment id.
 *
 * A cheap string hash feeds a linear congruential generator, so the same note always draws
 * the same bars across renders, sessions and devices.
 */
function buildWaveform(seed: string): number[] {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const bars: number[] = [];
  let state = hash || 1;
  for (let index = 0; index < BAR_COUNT; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    // Kept off the floor so a quiet passage still reads as a bar rather than a gap.
    bars.push(0.25 + (state % 1000) / 1000 * 0.75);
  }
  return bars;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
  },
  containerCompact: { paddingVertical: spacing[1.5] },
  playButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonDisabled: { backgroundColor: colors.outline },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 18,
  },
  bar: { width: 2.5, borderRadius: 2 },
  barPlayed: { backgroundColor: colors.primary },
  barPending: { backgroundColor: colors.surfaceTint, opacity: 0.35 },
  time: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: typography.dataMono.weight,
    color: colors.outline,
    fontVariant: ['tabular-nums'],
    minWidth: 30,
    textAlign: 'right',
  },
  rateChip: {
    paddingHorizontal: spacing[1.5],
    paddingVertical: spacing[0.5],
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  rateText: {
    fontFamily: fonts.sansBold,
    fontSize: typography.labelCaps.size,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
});
