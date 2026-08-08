import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  parseOrderTranscript,
  type MenuCandidate,
  type ParsedOrderTranscript,
} from '@menuboard/shared';
import { audioRecorder } from './audioRecorder';
import {
  getTranscriptionEngine,
  startWebDictation,
  type WebDictationHandle,
} from './transcriptionEngine';
import { voiceModelManager } from './voiceModelManager';
import type { VoicePackError } from './types';

/**
 * Drives one voice-order capture, from tapping the microphone to a parsed draft.
 *
 * Deliberately stops short of applying anything. It produces a transcript and a parse; the
 * screen decides what to do with them, and the user confirms. The specification is explicit
 * that an order is never submitted automatically, and keeping the submit path out of this
 * hook is what makes that structural rather than a rule someone has to remember.
 */

export type VoicePhase = 'IDLE' | 'RECORDING' | 'TRANSCRIBING' | 'REVIEW' | 'ERROR';

export interface UseVoiceOrderOptions {
  /** The board's menu, used to resolve spoken dish names to real items. */
  catalogue: readonly MenuCandidate[];
}

export interface UseVoiceOrder {
  phase: VoicePhase;
  durationMs: number;
  /** 0–1, for the waveform. */
  level: number;
  transcript: string;
  parsed: ParsedOrderTranscript | null;
  error: VoicePackError | null;
  /** False when the device cannot transcribe at all — no native module, no browser support. */
  supported: boolean;
  /** True when whisper is available but the model has not been installed yet. */
  needsVoicePack: boolean;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Re-parses after the user edits the transcript by hand. */
  setTranscript: (text: string) => void;
  reset: () => void;
}

export function useVoiceOrder({ catalogue }: UseVoiceOrderOptions): UseVoiceOrder {
  const [phase, setPhase] = useState<VoicePhase>('IDLE');
  const [durationMs, setDurationMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscriptState] = useState('');
  const [parsed, setParsed] = useState<ParsedOrderTranscript | null>(null);
  const [error, setError] = useState<VoicePackError | null>(null);
  const [needsVoicePack, setNeedsVoicePack] = useState(false);

  const engine = getTranscriptionEngine();
  const webHandle = useRef<WebDictationHandle | null>(null);
  const audioPath = useRef<string | null>(null);
  // Guards against a transcription resolving after the screen has gone away.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      webHandle.current?.abort();
      void audioRecorder.abort();
    };
  }, []);

  useEffect(() => {
    if (!engine.requiresVoicePack()) return;
    void voiceModelManager.getInstalled().then((installed) => {
      if (alive.current) setNeedsVoicePack(installed === null);
    });
  }, [engine]);

  const applyTranscript = useCallback(
    (text: string) => {
      setTranscriptState(text);
      setParsed(text.trim() === '' ? null : parseOrderTranscript(text, { catalogue }));
    },
    [catalogue],
  );

  const start = useCallback(async () => {
    setError(null);
    setTranscriptState('');
    setParsed(null);
    setDurationMs(0);

    if (!engine.isSupported()) {
      setPhase('ERROR');
      setError({
        kind: 'UNSUPPORTED_PLATFORM',
        message:
          Platform.OS === 'web'
            ? 'This browser cannot record speech. Use Chrome or Edge, or type the order.'
            : 'Voice orders need the full Android build. Type the order instead.',
      });
      return;
    }

    // The browser transcribes live from the microphone; there is no file to hand over.
    if (Platform.OS === 'web') {
      setPhase('RECORDING');
      const startedAt = Date.now();
      const ticker = setInterval(() => {
        if (alive.current) setDurationMs(Date.now() - startedAt);
      }, 200);

      webHandle.current = startWebDictation({
        onPartial: (text) => {
          if (alive.current) setTranscriptState(text);
        },
        onFinal: (text) => {
          clearInterval(ticker);
          if (!alive.current) return;
          applyTranscript(text);
          setPhase(text.trim() === '' ? 'IDLE' : 'REVIEW');
        },
        onError: (message) => {
          clearInterval(ticker);
          if (!alive.current) return;
          setError({ kind: 'UNKNOWN', message });
          setPhase('ERROR');
        },
      });
      return;
    }

    const installed = await voiceModelManager.getInstalled();
    if (installed === null) {
      setNeedsVoicePack(true);
      setPhase('IDLE');
      return;
    }

    const permission = await audioRecorder.requestPermission();
    if (permission !== 'granted') {
      setPhase('ERROR');
      setError({
        kind: 'UNKNOWN',
        message:
          permission === 'denied'
            ? 'Microphone access is blocked. Enable it for MenuBoard in Android settings.'
            : 'Microphone access is needed to dictate an order.',
      });
      return;
    }

    await audioRecorder.start((status) => {
      if (!alive.current) return;
      setDurationMs(status.durationMs);
      // dBFS is roughly -160 (silence) to 0 (clipping); -60 up is the useful speech band.
      setLevel(Math.max(0, Math.min(1, (status.metering + 60) / 60)));
    });
    setPhase('RECORDING');
  }, [applyTranscript, engine]);

  const stop = useCallback(async () => {
    if (Platform.OS === 'web') {
      webHandle.current?.stop();
      webHandle.current = null;
      return;
    }

    const recording = await audioRecorder.stop();
    setLevel(0);
    if (recording === null) {
      setPhase('IDLE');
      return;
    }

    audioPath.current = recording.path;
    setPhase('TRANSCRIBING');

    try {
      const installed = await voiceModelManager.getInstalled();
      if (installed === null) {
        setNeedsVoicePack(true);
        setPhase('IDLE');
        return;
      }

      const result = await engine.transcribe({
        audioPath: recording.path,
        modelPath: installed.filePath,
      });

      if (!alive.current) return;
      applyTranscript(result.text);
      setPhase(result.text.trim() === '' ? 'IDLE' : 'REVIEW');
    } catch (caught) {
      if (!alive.current) return;
      setError({
        kind: 'UNKNOWN',
        message:
          caught instanceof Error && caught.message !== ''
            ? caught.message
            : 'Could not understand the recording. Try again, or type the order.',
      });
      setPhase('ERROR');
    } finally {
      // The audio has produced its transcript and is no longer needed. Keeping a voice
      // sample of every order would be a liability with no corresponding benefit.
      await audioRecorder.discard(audioPath.current);
      audioPath.current = null;
    }
  }, [applyTranscript, engine]);

  const cancel = useCallback(async () => {
    webHandle.current?.abort();
    webHandle.current = null;
    await audioRecorder.abort();
    await audioRecorder.discard(audioPath.current);
    audioPath.current = null;
    setLevel(0);
    setDurationMs(0);
    setPhase('IDLE');
  }, []);

  const reset = useCallback(() => {
    setPhase('IDLE');
    setTranscriptState('');
    setParsed(null);
    setError(null);
    setDurationMs(0);
    setLevel(0);
  }, []);

  return {
    phase,
    durationMs,
    level,
    transcript,
    parsed,
    error,
    supported: engine.isSupported(),
    needsVoicePack,
    start,
    stop,
    cancel,
    setTranscript: applyTranscript,
    reset,
  };
}
