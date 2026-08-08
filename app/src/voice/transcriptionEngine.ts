import { Platform } from 'react-native';
import { isWhisperAvailable, transcribeWithWhisper } from './whisperModule';
import type { TranscriptionEngine, TranscriptionResult } from './types';

/**
 * Offline transcription through whisper.cpp.
 *
 * Everything stays on the device: the audio never leaves it, and no speech service is
 * contacted. That is the entire point of carrying a 148 MB model — a kitchen with no signal
 * still takes orders.
 */
const whisperEngine: TranscriptionEngine = {
  isSupported: () => isWhisperAvailable(),
  requiresVoicePack: () => true,
  async transcribe({ audioPath, modelPath }): Promise<TranscriptionResult> {
    const result = await transcribeWithWhisper({ audioPath, modelPath });
    return {
      text: result.text.trim(),
      language: result.language,
      durationMs: result.durationMs,
    };
  },
};

/**
 * Browser fallback for the development shim.
 *
 * The Web Speech API is the only speech recognition available in a browser, and in Chrome
 * and Edge it is a *cloud* service — which is exactly what the specification rules out for
 * the shipping app. It is wired up anyway, and only on web, because the whole point of the
 * shim is to iterate on the order flow without an Android rebuild. Nothing here runs on a
 * device.
 *
 * It takes no audio file: the browser listens to the microphone itself, so `startWebDictation`
 * below is the real entry point and `transcribe` exists only to satisfy the interface.
 */
const webEngine: TranscriptionEngine = {
  isSupported: () => Platform.OS === 'web' && webSpeechRecognitionAvailable(),
  requiresVoicePack: () => false,
  async transcribe(): Promise<TranscriptionResult> {
    throw new Error(
      'On web, use startWebDictation() — the browser transcribes live rather than from a file.',
    );
  },
};

export function getTranscriptionEngine(): TranscriptionEngine {
  return Platform.OS === 'web' ? webEngine : whisperEngine;
}

/* ------------------------------------------------------------ web dictation */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
}

function speechRecognitionConstructor(): (new () => SpeechRecognitionLike) | null {
  if (typeof globalThis === 'undefined') return null;
  const scope = globalThis as unknown as Record<string, unknown>;
  return (scope['SpeechRecognition'] ?? scope['webkitSpeechRecognition']) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export function webSpeechRecognitionAvailable(): boolean {
  return Platform.OS === 'web' && speechRecognitionConstructor() !== null;
}

export interface WebDictationHandle {
  stop(): void;
  abort(): void;
}

/**
 * Starts live browser dictation, calling back with interim and final text.
 *
 * `hi-IN` is requested rather than `en-IN`: Chrome's Indian Hindi model transcribes English
 * words inside a Hindi sentence far better than the reverse, which is the shape a Hinglish
 * order actually takes.
 */
export function startWebDictation(callbacks: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): WebDictationHandle {
  const Recognition = speechRecognitionConstructor();
  if (Recognition === null) {
    callbacks.onError('This browser cannot record speech. Use Chrome or Edge.');
    return { stop: () => {}, abort: () => {} };
  }

  const recognition = new Recognition();
  recognition.lang = 'hi-IN';
  recognition.continuous = true;
  recognition.interimResults = true;

  let finalText = '';

  recognition.onresult = (event) => {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result === undefined) continue;
      const alternative = result[0];
      if (alternative === undefined) continue;
      if (result.isFinal) finalText += `${alternative.transcript} `;
      else interim += alternative.transcript;
    }
    callbacks.onPartial(`${finalText}${interim}`.trim());
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') {
      callbacks.onError('Nothing was heard. Try again and speak closer to the microphone.');
      return;
    }
    if (event.error === 'not-allowed') {
      callbacks.onError('Microphone access was blocked. Allow it in your browser settings.');
      return;
    }
    callbacks.onError('Speech recognition failed. Try again.');
  };

  recognition.onend = () => {
    callbacks.onFinal(finalText.trim());
  };

  recognition.start();

  return {
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}
