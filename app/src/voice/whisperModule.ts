import { NativeModules, Platform } from 'react-native';

/**
 * JavaScript face of the `MenuBoardWhisper` native module.
 *
 * The module is only present in a development/production build that ran `expo prebuild` —
 * it cannot exist in Expo Go, and there is no web implementation. Rather than crashing on
 * import when it is absent, every entry point checks {@link isWhisperAvailable} and the
 * callers fall back to a clearly-explained unsupported state.
 *
 * See `app/android/app/src/main/java/com/menuboard/whisper/` for the Kotlin side and
 * `docs/VOICE.md` for the build steps.
 */

interface WhisperNativeModule {
  /**
   * Streaming SHA-256 of a file. Lives here because JavaScript cannot hash a 148 MB file
   * without loading it into memory, and expo-crypto only digests strings.
   */
  sha256File(path: string): Promise<string>;

  /** Loads the model into memory. Idempotent; a second call with the same path is a no-op. */
  initContext(modelPath: string): Promise<void>;

  /** Frees the model. Called when the voice pack is deleted or replaced. */
  releaseContext(): Promise<void>;

  /**
   * Transcribes a WAV file. `language` may be an ISO code or `auto`; the multilingual model
   * detects Hindi and English on its own, which is what makes Hinglish work.
   */
  transcribe(options: {
    audioPath: string;
    modelPath: string;
    language: string;
    translate: boolean;
    threads: number;
  }): Promise<{ text: string; language: string | null; durationMs: number }>;
}

const nativeModule = (NativeModules as Record<string, unknown>)['MenuBoardWhisper'] as
  | WhisperNativeModule
  | undefined;

export function isWhisperAvailable(): boolean {
  return Platform.OS === 'android' && nativeModule !== undefined;
}

function requireModule(): WhisperNativeModule {
  if (nativeModule === undefined) {
    throw new Error(
      'The whisper native module is not present in this build. ' +
        'Run `npx expo prebuild` and rebuild the Android app — it is unavailable in Expo Go and on web.',
    );
  }
  return nativeModule;
}

/**
 * Streaming SHA-256 of a file on disk.
 *
 * On a platform without the native module this throws rather than returning a wrong or
 * placeholder digest: the checksum exists to prove the model is intact, and a verification
 * step that can silently pass is worse than none.
 */
export async function sha256File(path: string): Promise<string> {
  return requireModule().sha256File(path);
}

export async function initWhisperContext(modelPath: string): Promise<void> {
  return requireModule().initContext(modelPath);
}

export async function releaseWhisperContext(): Promise<void> {
  if (nativeModule === undefined) return;
  return nativeModule.releaseContext();
}

export async function transcribeWithWhisper(options: {
  audioPath: string;
  modelPath: string;
  language?: string;
  threads?: number;
}): Promise<{ text: string; language: string | null; durationMs: number }> {
  return requireModule().transcribe({
    audioPath: options.audioPath,
    modelPath: options.modelPath,
    // `auto` lets the multilingual model pick between Hindi and English per utterance, which
    // is the only way a sentence that mixes both transcribes correctly.
    language: options.language ?? 'auto',
    // Never translate: an order dictated in Hindi must stay in Hindi so the menu normalizer
    // sees the dish names the catalogue actually contains.
    translate: false,
    threads: options.threads ?? 4,
  });
}
