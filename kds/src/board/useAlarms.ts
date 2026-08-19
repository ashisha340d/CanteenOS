import { useCallback, useEffect, useRef, useState } from 'react';
import type { KdsConfigDto, KdsQueueDto } from '@menuboard/shared';
import { http } from '../api/client';

type Tone = 'newOrder' | 'attention' | 'critical';

/**
 * The tone paths the server hands out (`/api/v1/alerts/sounds/:slot`) sit behind auth, and an
 * `<audio src>` cannot attach the Bearer header — so bytes come down through the authenticated
 * client and become blob URLs for the elements.
 */
async function fetchToneObjectUrl(path: string): Promise<string> {
  const response = await http.get<Blob>(path.replace(/^\/api\/v1/, ''), { responseType: 'blob' });
  return URL.createObjectURL(response.data);
}

/**
 * Blob URLs by tone path, for the life of the page. The three alarm files never change during a
 * shift, so downloading them again — on a remount, a config refetch, or a tab switch — is pure
 * waste on a display that is also polling a queue.
 */
const toneCache = new Map<string, string>();

/** Synthesised fallback when the admin has uploaded no file — three clearly different patterns. */
function synthBeep(tone: Tone, ctx: AudioContext, volume: number): void {
  const patterns: Record<Tone, [number, number, number][]> = {
    newOrder: [[880, 0, 0.14], [880, 0.2, 0.14]],
    attention: [[660, 0, 0.18], [660, 0.26, 0.18], [990, 0.52, 0.22]],
    critical: [[520, 0, 0.3], [392, 0.4, 0.3], [520, 0.8, 0.3], [392, 1.2, 0.3]],
  };
  for (const [frequency, offset, duration] of patterns[tone]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.09 * volume, ctx.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + offset);
    osc.stop(ctx.currentTime + offset + duration + 0.02);
  }
}

/** Where one line stands in the alarm story. Each stage speaks once; critical then repeats. */
type Phase = 'waiting' | 'attention' | 'critical';

interface LineClock {
  dueAt: number;
  phase: Phase;
  /** When the critical buzzer last sounded for this line. */
  lastCriticalAt: number;
}

/**
 * The board's alarm engine, driven entirely by admin settings (KdsConfigDto):
 *
 *   new order      one buzz the moment an order first appears on this board
 *   attention      one buzz per line, `dueSoonSeconds` before that line is due
 *   critical       one buzz the moment a line passes its due time…
 *   critical again …then every `overdueRepeatSeconds` while it stays unserved
 *
 * A board has no say in any of it: no tone choice, no volume, no mute. The one thing it does
 * locally is `unlock`, because browsers refuse to play audio before a user gesture.
 *
 * The first queue snapshot after a reload is adopted silently — reopening a board that already
 * has ten orders on it is not ten new orders.
 */
export function useAlarms(queue: KdsQueueDto | undefined, config: KdsConfigDto | undefined): {
  unlock: () => void;
  soundReady: boolean;
} {
  const [soundReady, setSoundReady] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const elementsRef = useRef<Partial<Record<Tone, HTMLAudioElement>>>({});
  const linesRef = useRef<Map<string, LineClock>>(new Map());
  const knownOrdersRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);
  const volumeRef = useRef(0.8);

  volumeRef.current = config?.alarmVolume ?? 0.8;

  /* Load each tone once per *path*, not once per config object.
     The board refetches its config whenever anything on it is invalidated, and keying this on
     the config object meant every serve re-downloaded all three files — hundreds of kilobytes
     of audio, repeatedly, on the busiest screen in the building. The paths are what actually
     decide the sound, so they are the dependency, and a blob already fetched is reused. */
  const tonePaths = [config?.toneNewOrder ?? '', config?.toneDueSoon ?? '', config?.toneOverdue ?? ''];
  const tonePathKey = tonePaths.join('|');

  useEffect(() => {
    if (config === undefined) return;
    const paths: Record<Tone, string | null> = {
      newOrder: config.toneNewOrder,
      attention: config.toneDueSoon,
      critical: config.toneOverdue,
    };
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      for (const tone of ['newOrder', 'attention', 'critical'] as Tone[]) {
        const path = paths[tone];
        if (path === null) continue;
        try {
          const cached = toneCache.get(path);
          const url = cached ?? (await fetchToneObjectUrl(path));
          if (cached === undefined) {
            toneCache.set(path, url);
            created.push(url);
          }
          if (cancelled) continue;
          const el = new Audio(url);
          el.preload = 'auto';
          el.volume = volumeRef.current;
          elementsRef.current[tone] = el;
        } catch (error) {
          // The synth fallback keeps the board audible, but a tone that will not load is a
          // configuration fault worth seeing rather than a silence nobody can explain.
          console.warn(`KDS alarm: could not load the ${tone} tone from ${path}`, error);
        }
      }
    })();

    return () => {
      cancelled = true;
      elementsRef.current = {};
      // The blobs stay in `toneCache`: the same three files are wanted for the whole shift, and
      // re-fetching them on every remount is what this cache exists to prevent.
      void created;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tonePathKey]);

  // Volume is admin-owned and can change under a board that never reloads.
  useEffect(() => {
    for (const el of Object.values(elementsRef.current)) el.volume = volumeRef.current;
  }, [config?.alarmVolume]);

  const play = useCallback((tone: Tone): void => {
    const volume = volumeRef.current;
    if (volume <= 0) return;
    const el = elementsRef.current[tone];
    if (el !== undefined) {
      el.volume = volume;
      el.currentTime = 0;
      void el.play().catch(() => setSoundReady(false));
      return;
    }
    const ctx = audioCtxRef.current;
    if (ctx !== null) synthBeep(tone, ctx, volume);
  }, []);

  const playRef = useRef(play);
  playRef.current = play;

  const unlock = useCallback((): void => {
    if (audioCtxRef.current === null) {
      audioCtxRef.current = new AudioContext();
    }
    void audioCtxRef.current.resume().catch(() => undefined);
    for (const el of Object.values(elementsRef.current)) {
      void el
        .play()
        .then(() => {
          el.pause();
          el.currentTime = 0;
          setSoundReady(true);
        })
        .catch(() => setSoundReady(false));
    }
    setSoundReady(true);
  }, []);

  /* Track the queue: register new lines and their due times, retire lines that left. The
     new-order buzz is per *order*, not per line — a four-item ticket is one arrival. */
  useEffect(() => {
    if (queue === undefined || config === undefined) return;
    const now = Date.now();
    const seenLines = new Set<string>();
    let arrivals = 0;

    for (const order of queue.orders) {
      const base = new Date(order.placedAt ?? order.createdAt).getTime();
      const openLines = order.lines.filter((line) => line.kdsStatus !== 'SERVED');
      if (openLines.length === 0) continue;

      if (!knownOrdersRef.current.has(order.id)) {
        knownOrdersRef.current.add(order.id);
        arrivals += 1;
      }

      for (const line of openLines) {
        seenLines.add(line.id);
        if (linesRef.current.has(line.id)) continue;
        const dueAt = base + (line.prepSeconds ?? config.defaultPrepSeconds) * 1000;
        // A line adopted already past a stage does not replay it — it starts where it stands.
        const phase: Phase =
          now >= dueAt ? 'critical' : now >= dueAt - config.dueSoonSeconds * 1000 ? 'attention' : 'waiting';
        linesRef.current.set(line.id, {
          dueAt,
          phase,
          lastCriticalAt: phase === 'critical' ? now : 0,
        });
      }
    }

    for (const lineId of [...linesRef.current.keys()]) {
      if (!seenLines.has(lineId)) linesRef.current.delete(lineId);
    }
    // An order that fully cleared can arrive again later (a revert) and count as fresh.
    for (const orderId of [...knownOrdersRef.current]) {
      if (!queue.orders.some((order) => order.id === orderId)) knownOrdersRef.current.delete(orderId);
    }

    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      return;
    }
    if (arrivals > 0) playRef.current('newOrder');
  }, [queue, config]);

  /* One second-ticker owns every deadline, so alarms do not wait on a refetch. */
  useEffect(() => {
    if (config === undefined) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const attentionAt = config.dueSoonSeconds * 1000;
      const repeatMs = config.overdueRepeatSeconds * 1000;

      for (const clock of linesRef.current.values()) {
        if (now >= clock.dueAt) {
          if (clock.phase !== 'critical') {
            clock.phase = 'critical';
            clock.lastCriticalAt = now;
            playRef.current('critical');
          } else if (now - clock.lastCriticalAt >= repeatMs) {
            clock.lastCriticalAt = now;
            playRef.current('critical');
          }
          continue;
        }
        if (clock.phase === 'waiting' && now >= clock.dueAt - attentionAt) {
          clock.phase = 'attention';
          playRef.current('attention');
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [config]);

  return { unlock, soundReady };
}
