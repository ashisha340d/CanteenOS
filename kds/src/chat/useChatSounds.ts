import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AlertSoundSlot, type AlertSoundDto } from '@menuboard/shared';
import { http, unwrap } from '../api/client';

type ChatTone = 'message' | 'bell';

const SLOT_FOR: Record<ChatTone, AlertSoundSlot> = {
  message: AlertSoundSlot.CHAT_MESSAGE,
  bell: AlertSoundSlot.CHAT_BELL,
};

/**
 * Blob URLs by slot, for the life of the page. Same reasoning as the alarm tones in
 * `useAlarms`: the files do not change during a shift, and a wall screen that is already
 * polling a queue should not also be re-downloading audio.
 */
const cache = new Map<string, string>();

/**
 * The uploaded file's bytes. The route sits behind auth and an `<audio src>` cannot carry a
 * Bearer header, so the bytes come down through the authenticated client and become a blob URL.
 */
async function fetchToneUrl(slot: AlertSoundSlot): Promise<string> {
  const cached = cache.get(slot);
  if (cached !== undefined) return cached;
  const response = await http.get<Blob>(`/alerts/sounds/${slot}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(response.data);
  cache.set(slot, url);
  return url;
}

/** One scheduled note: frequency, when it starts, how long it lasts. */
type Note = [number, number, number];

/**
 * The fallback when the office has uploaded nothing.
 *
 * A message is a soft two-note nudge. The bell is a **warble** — two tones alternating over
 * most of a second, the shape every telephone has used since they had bells in them — and it
 * is deliberately far louder than the message: it is meant to carry to somebody who is not
 * looking at the screen and may not be standing next to it.
 */
const PATTERNS: Record<ChatTone, { gain: number; notes: Note[] }> = {
  message: { gain: 0.16, notes: [[784, 0, 0.11], [1046, 0.1, 0.16]] },
  bell: {
    gain: 0.5,
    notes: [
      [1046, 0, 0.13],
      [784, 0.13, 0.13],
      [1046, 0.26, 0.13],
      [784, 0.39, 0.13],
      [1046, 0.52, 0.13],
      [784, 0.65, 0.2],
    ],
  },
};

/**
 * The two chat sounds, uploaded by the office on Settings → Chat & Messaging.
 *
 * Deliberately separate from `useAlarms`: those are the board's service alarms, admin-owned and
 * unsilenceable, and folding a chat notification into that engine would mean a message could
 * not be distinguished from a late order — which is the one distinction that matters when both
 * happen at once.
 *
 * Everything here bends around one browser rule: **audio needs user activation**. A document
 * nobody has clicked cannot make noise, and an `AudioContext` created before that click comes
 * up suspended — where its clock is frozen, so notes scheduled against `currentTime` land in a
 * moment that never arrives and are simply never heard. That silent failure, not a missing
 * file, is what makes a bell light up the screen and ring nowhere.
 */
export function useChatSounds(): {
  play: (tone: ChatTone) => void;
  /** Silences everything this hook is playing, immediately — including notes still scheduled. */
  stop: () => void;
  unlock: () => void;
} {
  const elements = useRef<Partial<Record<ChatTone, HTMLAudioElement>>>({});
  const ctxRef = useRef<AudioContext | null>(null);
  /** Oscillators sounding or scheduled to, so `stop` can reach them. */
  const liveOsc = useRef<Set<OscillatorNode>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await unwrap(
          http.get<{ success: true; data: AlertSoundDto[] }>('/alerts/sounds'),
        );
        for (const tone of ['message', 'bell'] as ChatTone[]) {
          const row = rows.find((entry) => entry.slot === SLOT_FOR[tone]);
          // No file uploaded for the slot: the synth pattern carries it.
          if (row === undefined || row.fileName === null) continue;
          const url = await fetchToneUrl(SLOT_FOR[tone]);
          if (cancelled) return;
          const el = new Audio(url);
          el.preload = 'auto';
          elements.current[tone] = el;
        }
      } catch {
        // A sound that will not load is never worth failing a conversation over.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ensureContext = useCallback((): AudioContext | null => {
    try {
      ctxRef.current ??= new AudioContext();
    } catch {
      return null;
    }
    return ctxRef.current;
  }, []);

  const unlock = useCallback((): void => {
    const ctx = ensureContext();
    if (ctx === null) return;
    void ctx.resume().catch(() => undefined);
  }, [ensureContext]);

  /* Unlock on the first interaction *anywhere*, not only through the board's own pointer
     handler. A counter person's first act is often a keystroke, or a tap on the chat panel
     itself, and an unlock wired to one container silently missed those. Capture phase and
     `once`, so it costs a single listener that removes itself. */
  useEffect(() => {
    const onFirstGesture = (): void => unlock();
    const options = { once: true, capture: true } as const;
    document.addEventListener('pointerdown', onFirstGesture, options);
    document.addEventListener('keydown', onFirstGesture, options);
    return () => {
      document.removeEventListener('pointerdown', onFirstGesture, options);
      document.removeEventListener('keydown', onFirstGesture, options);
    };
  }, [unlock]);

  const stop = useCallback((): void => {
    for (const el of Object.values(elements.current)) {
      el.pause();
      el.currentTime = 0;
    }
    for (const osc of liveOsc.current) {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        // Already finished on its own; nothing to cut.
      }
    }
    liveOsc.current.clear();
  }, []);

  /** Schedules one pattern. Only ever called with a context that is already running. */
  const schedule = useCallback((tone: ChatTone, ctx: AudioContext): void => {
    const { gain: level, notes } = PATTERNS[tone];
    // A hair in the future: scheduling exactly at `currentTime` can be missed by the audio
    // thread, which is heard as a dropped first note.
    const start = ctx.currentTime + 0.02;

    for (const [frequency, offset, duration] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = tone === 'bell' ? 'square' : 'sine';
      osc.frequency.value = frequency;
      // Ramped in as well as out: a square wave switched on at full level clicks audibly.
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(level, start + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + duration + 0.02);

      liveOsc.current.add(osc);
      osc.onended = () => liveOsc.current.delete(osc);
    }
  }, []);

  const play = useCallback(
    (tone: ChatTone): void => {
      const el = elements.current[tone];
      if (el !== undefined) {
        el.currentTime = 0;
        // A rejected play is the autoplay policy, not a broken file — fall through to the
        // synth rather than leaving the counter with nothing at all.
        void el.play().catch(() => {
          const ctx = ensureContext();
          if (ctx === null) return;
          void ctx
            .resume()
            .then(() => schedule(tone, ctx))
            .catch(() => undefined);
        });
        return;
      }

      const ctx = ensureContext();
      if (ctx === null) return;

      /* A suspended context has a frozen clock, so scheduling against it now would queue the
         notes into a moment that never comes. Resume first and schedule inside the resolution:
         this is the whole reason a bell could light up the screen in silence. */
      if (ctx.state === 'suspended') {
        void ctx
          .resume()
          .then(() => schedule(tone, ctx))
          .catch(() => undefined);
        return;
      }
      schedule(tone, ctx);
    },
    [ensureContext, schedule],
  );

  /* Memoised: this object sits in the dependency list of the socket-listener effect in
     `useCounterChat`, and `CounterBoard` re-renders every second off `useNow`. A fresh literal
     here would tear down and re-register all three chat listeners sixty times a minute, for
     weeks, on a screen that never reloads. */
  return useMemo(() => ({ play, stop, unlock }), [play, stop, unlock]);
}
