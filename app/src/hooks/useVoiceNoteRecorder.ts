import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

/**
 * Voice notes for the board feed.
 *
 * Distinct from `src/voice/audioRecorder.ts`, which captures 16 kHz WAV for Whisper: a note
 * posted to the feed is stored and synced to every member, so it is recorded compressed. Same
 * microphone, different destination, different trade-off.
 *
 * The metering value is smoothed into a 0–1 level for the compose bar's pulse. Raw dBFS
 * jitters enough to look like a fault rather than a signal.
 */

export interface VoiceTake {
  uri: string;
  durationMs: number;
  sizeBytes: number;
}

export interface VoiceNoteRecorder {
  isRecording: boolean;
  durationMs: number;
  /** 0–1, smoothed, for the recording indicator. */
  level: number;
  permissionDenied: boolean;
  start: () => Promise<void>;
  /** Stops and returns the take, or null if nothing was recording or it was too short. */
  stop: () => Promise<VoiceTake | null>;
  cancel: () => Promise<void>;
}

/** Below this, a "recording" is a mis-tap rather than a message. */
const MIN_DURATION_MS = 700;

/**
 * AAC in an m4a container. Stated explicitly rather than spread from
 * `RecordingOptionsPresets.HIGH_QUALITY`, whose platform blocks are optional in the type and
 * so cannot satisfy `RecordingOptions` under `exactOptionalPropertyTypes`.
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 44100,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

export function useVoiceNoteRecorder(): VoiceNoteRecorder {
  const recordingRef = useRef<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // Unmounting mid-take must not leave the microphone held open.
  useEffect(
    () => () => {
      void recordingRef.current?.stopAndUnloadAsync().catch(() => undefined);
      recordingRef.current = null;
    },
    [],
  );

  const start = useCallback(async () => {
    if (recordingRef.current !== null) return;

    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    const { recording } = await Audio.Recording.createAsync(
      RECORDING_OPTIONS,
      (status) => {
        setDurationMs(status.durationMillis ?? 0);
        setLevel((previous) => smooth(previous, normaliseMetering(status.metering)));
      },
    );

    recordingRef.current = recording;
    setDurationMs(0);
    setLevel(0);
    setIsRecording(true);
  }, []);

  const finish = useCallback(async (): Promise<VoiceTake | null> => {
    const recording = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    setLevel(0);
    if (recording === null) return null;

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = recording.getURI();
    if (uri === null) return null;

    const status = await recording.getStatusAsync();
    const info = await FileSystem.getInfoAsync(uri);
    return {
      uri,
      durationMs: status.durationMillis ?? 0,
      sizeBytes: info.exists && 'size' in info ? info.size : 0,
    };
  }, []);

  const stop = useCallback(async (): Promise<VoiceTake | null> => {
    const take = await finish();
    if (take === null) return null;
    if (take.durationMs < MIN_DURATION_MS) {
      await FileSystem.deleteAsync(take.uri, { idempotent: true }).catch(() => undefined);
      return null;
    }
    return take;
  }, [finish]);

  const cancel = useCallback(async () => {
    const take = await finish();
    if (take !== null) {
      await FileSystem.deleteAsync(take.uri, { idempotent: true }).catch(() => undefined);
    }
    setDurationMs(0);
  }, [finish]);

  return { isRecording, durationMs, level, permissionDenied, start, stop, cancel };
}

/** dBFS (-160 silent … 0 clipping) to 0–1, with the useful range stretched over -50…0. */
function normaliseMetering(metering: number | undefined): number {
  if (metering === undefined || !Number.isFinite(metering)) return 0;
  const clamped = Math.max(-50, Math.min(0, metering));
  return (clamped + 50) / 50;
}

function smooth(previous: number, next: number): number {
  return previous + (next - previous) * 0.35;
}
