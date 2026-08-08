import { useEffect, useState } from 'react';

/**
 * A shared one-second clock.
 *
 * Every visible order card needs the same tick, and giving each its own `setInterval` on a
 * long feed means dozens of timers waking the JS thread at slightly different moments. One
 * module-level interval, started when the first card subscribes and cleared when the last
 * unsubscribes, keeps the cost flat no matter how many cards are on screen — and keeps every
 * countdown on the board in step with the others.
 */
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(callback: () => void): () => void {
  subscribers.add(callback);
  if (timer === null) {
    timer = setInterval(() => {
      for (const notify of subscribers) notify();
    }, 1000);
  }
  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export interface Countdown {
  /** Milliseconds until the deadline; negative once it has passed. */
  remainingMs: number;
  /** `MM:SS` under an hour, `H:MM:SS` above it. Empty when there is no deadline. */
  text: string;
  overdue: boolean;
  /** True inside the warning window — what the card uses to turn the ticker red. */
  urgent: boolean;
}

/**
 * Counts down to an order's required date/time.
 *
 * Only ticks inside `windowMs` of the deadline (default 30 minutes). Outside that window an
 * order is not "closing", and a ticker on every future order would be noise — so the hook
 * subscribes to the clock only while the number is worth watching, which also means a board
 * full of next-week orders schedules no work at all.
 */
export function useCountdown(
  isoDate: string | null,
  clockTime: string | null,
  windowMs = 30 * 60 * 1000,
  enabled = true,
): Countdown | null {
  const deadline =
    isoDate === null || clockTime === null ? null : parseDeadline(isoDate, clockTime);

  const [now, setNow] = useState(() => Date.now());

  // Recomputed on every render rather than stored, so it cannot go stale between ticks.
  const remainingMs = deadline === null ? 0 : deadline - now;
  const withinWindow =
    deadline !== null && enabled && remainingMs <= windowMs && remainingMs > -windowMs;

  useEffect(() => {
    if (!withinWindow) return undefined;
    return subscribe(() => setNow(Date.now()));
  }, [withinWindow]);

  if (deadline === null || !enabled) return null;
  if (!withinWindow) return null;

  return {
    remainingMs,
    text: formatRemaining(Math.abs(remainingMs)),
    overdue: remainingMs < 0,
    urgent: remainingMs <= windowMs,
  };
}

/**
 * Builds a local `Date` from the order's stored parts.
 *
 * `new Date('2026-08-08T12:00')` is parsed as local time, whereas appending a `Z` would read
 * it as UTC — an order due at noon in the kitchen is due at noon on the wall clock, not at
 * noon in Greenwich.
 */
function parseDeadline(isoDate: string, clockTime: string): number | null {
  const time = clockTime.length === 5 ? `${clockTime}:00` : clockTime;
  const parsed = new Date(`${isoDate}T${time}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

/** True once the order's required date/time has passed. */
export function isPastDeadline(isoDate: string | null, clockTime: string | null): boolean {
  if (isoDate === null || clockTime === null) return false;
  const deadline = parseDeadline(isoDate, clockTime);
  return deadline !== null && Date.now() > deadline;
}

function formatRemaining(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
