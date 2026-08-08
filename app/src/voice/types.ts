import type { VoiceModelManifestDto } from '@menuboard/shared';

/** Where the voice pack stands on this device. */
export type VoicePackState =
  | { status: 'CHECKING' }
  | { status: 'NOT_INSTALLED'; manifest: VoiceModelManifestDto | null }
  | { status: 'DOWNLOADING'; progress: number; receivedBytes: number; totalBytes: number }
  | { status: 'VERIFYING' }
  | { status: 'INSTALLED'; version: string; sizeBytes: number; updateAvailable: boolean }
  | { status: 'ERROR'; error: VoicePackError };

/**
 * Failure modes are enumerated rather than free-text so the UI can offer the right recovery
 * — "retry" for a network drop, "free up space" for storage, "not supported" for the web
 * shim — instead of showing the same generic message for all of them.
 */
export type VoicePackErrorKind =
  | 'OFFLINE'
  | 'STORAGE_FULL'
  | 'CHECKSUM_MISMATCH'
  | 'SERVER_UNAVAILABLE'
  | 'CANCELLED'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNKNOWN';

export interface VoicePackError {
  kind: VoicePackErrorKind;
  message: string;
}

/** Metadata for the installed model, persisted alongside the weights. */
export interface InstalledVoicePack {
  version: string;
  model: string;
  sha256: string;
  sizeBytes: number;
  installedAt: string;
  /** Absolute path in app-private storage. Never in a public Downloads folder. */
  filePath: string;
}

export type TranscriptionState =
  | { status: 'IDLE' }
  | { status: 'RECORDING'; durationMs: number; metering: number }
  | { status: 'TRANSCRIBING' }
  | { status: 'DONE'; transcript: string }
  | { status: 'ERROR'; error: VoicePackError };

export interface TranscriptionResult {
  text: string;
  /** BCP-47-ish tag the model detected, e.g. `hi` or `en`. Null when unknown. */
  language: string | null;
  durationMs: number;
}

/**
 * What a transcription backend must provide.
 *
 * Two implementations exist: whisper.cpp through the native module on Android, and the
 * browser's Web Speech API in the development shim. Keeping them behind one interface means
 * the order flow, the parser and the UI are written once.
 */
export interface TranscriptionEngine {
  /** Whether this device can transcribe at all, irrespective of model installation. */
  isSupported(): boolean;
  /** True when the engine needs the downloadable model (whisper) rather than an OS service. */
  requiresVoicePack(): boolean;
  transcribe(input: { audioPath: string; modelPath: string }): Promise<TranscriptionResult>;
}
