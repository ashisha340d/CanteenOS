import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

/**
 * Microphone capture for voice orders.
 *
 * whisper.cpp wants 16 kHz mono PCM, so recording is configured to produce that directly
 * rather than transcoding afterwards — a resample step on device would be both slow and one
 * more thing to get wrong.
 *
 * Recordings are treated as transient. They live in the cache directory, never the document
 * directory, and {@link discard} removes the file as soon as its transcript exists. Nothing
 * about the audio is logged.
 */

/**
 * 16 kHz mono, the sample rate Whisper's front-end expects.
 *
 * Android records WAV/PCM directly. iOS has no uncompressed option through expo-av that
 * whisper.cpp reads without help, but the Android app is the shipping target and the web
 * shim never reaches this code, so the iOS entry stays a reasonable default rather than a
 * verified path.
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
  },
  ios: {
    extension: '.wav',
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 256000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 128000,
  },
};

export interface RecordingStatus {
  durationMs: number;
  /** dBFS from the microphone, for the waveform. Roughly -160 (silence) to 0 (clipping). */
  metering: number;
}

export type PermissionOutcome = 'granted' | 'denied' | 'undetermined';

let current: Audio.Recording | null = null;

export const audioRecorder = {
  /**
   * Asks for the microphone. The caller explains *why* before invoking this, so the OS
   * prompt is never the first thing the user sees.
   */
  async requestPermission(): Promise<PermissionOutcome> {
    const response = await Audio.requestPermissionsAsync();
    if (response.granted) return 'granted';
    return response.canAskAgain ? 'undetermined' : 'denied';
  },

  isRecording(): boolean {
    return current !== null;
  },

  async start(onStatus?: (status: RecordingStatus) => void): Promise<void> {
    if (current !== null) return;

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS, (status) => {
      onStatus?.({
        durationMs: status.durationMillis ?? 0,
        metering: status.metering ?? -160,
      });
    });
    current = recording;
  },

  /** Stops and returns the file path, or null when nothing was being recorded. */
  async stop(): Promise<{ path: string; durationMs: number } | null> {
    const recording = current;
    current = null;
    if (recording === null) return null;

    await recording.stopAndUnloadAsync();
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

    const uri = recording.getURI();
    if (uri === null) return null;

    const status = await recording.getStatusAsync();
    return { path: uri, durationMs: status.durationMillis ?? 0 };
  },

  /**
   * Deletes a recording. Called once its transcript has been produced — the audio has served
   * its purpose and keeping a voice sample of every order is a liability, not a feature.
   */
  async discard(path: string | null): Promise<void> {
    if (path === null || Platform.OS === 'web') return;
    try {
      await FileSystem.deleteAsync(path, { idempotent: true });
    } catch {
      // A stranded cache file is harmless; the OS reclaims the cache directory under pressure.
    }
  },

  /** Aborts and cleans up, for a cancelled recording. */
  async abort(): Promise<void> {
    const result = await this.stop();
    await this.discard(result?.path ?? null);
  },
};
