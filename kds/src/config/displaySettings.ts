import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';

/* A screen's own look: skin, text size and card size, remembered per station so two
   displays on the same browser profile never fight over one setting. */

export type KdsSkin = 'light' | 'dark' | 'system';
export type KdsDensity = 'compact' | 'default' | 'light';

export interface KdsDisplaySettings {
  skin: KdsSkin;
  density: KdsDensity;
  /** Card grid size multiplier, 0.8 – 1.5. */
  cardScale: number;
  /** Queue tab type size, 0.8 – 2.4 — set from the [-A] [+A] buttons on the queue header. */
  queueScale: number;
  /** Auto out-of-station after this many idle minutes; 0 switches the detection off. */
  idleAwayMinutes: number;
}

export const DEFAULT_DISPLAY_SETTINGS: KdsDisplaySettings = {
  skin: 'dark',
  density: 'default',
  cardScale: 1,
  queueScale: 1.25,
  idleAwayMinutes: 5,
};

export const QUEUE_SCALE_MIN = 0.8;
export const QUEUE_SCALE_MAX = 2.4;
export const QUEUE_SCALE_STEP = 0.15;

const keyFor = (stationId: string): string => `menuboard.kds.display.${stationId}`;

function clampCardScale(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DISPLAY_SETTINGS.cardScale;
  return Math.min(1.5, Math.max(0.8, num));
}

export function clampQueueScale(value: unknown): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_DISPLAY_SETTINGS.queueScale;
  return Math.min(QUEUE_SCALE_MAX, Math.max(QUEUE_SCALE_MIN, Math.round(num * 100) / 100));
}

export function readDisplaySettings(stationId: string): KdsDisplaySettings {
  const raw = localStorage.getItem(keyFor(stationId));
  if (raw === null) return DEFAULT_DISPLAY_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<KdsDisplaySettings>;
    return {
      skin:
        parsed.skin === 'light' || parsed.skin === 'dark' || parsed.skin === 'system'
          ? parsed.skin
          : DEFAULT_DISPLAY_SETTINGS.skin,
      density:
        parsed.density === 'compact' || parsed.density === 'default' || parsed.density === 'light'
          ? parsed.density
          : DEFAULT_DISPLAY_SETTINGS.density,
      cardScale: clampCardScale(parsed.cardScale),
      queueScale: clampQueueScale(parsed.queueScale),
      idleAwayMinutes:
        typeof parsed.idleAwayMinutes === 'number' && parsed.idleAwayMinutes >= 0
          ? Math.min(60, Math.round(parsed.idleAwayMinutes))
          : DEFAULT_DISPLAY_SETTINGS.idleAwayMinutes,
    };
  } catch {
    return DEFAULT_DISPLAY_SETTINGS;
  }
}

export function saveDisplaySettings(stationId: string, settings: KdsDisplaySettings): void {
  localStorage.setItem(keyFor(stationId), JSON.stringify(settings));
}

export interface DisplaySettingsApi {
  settings: KdsDisplaySettings;
  update: (patch: Partial<KdsDisplaySettings>) => void;
  /** 'system' resolves against the OS preference, live. */
  resolvedSkin: 'light' | 'dark';
  style: CSSProperties;
}

export function useDisplaySettings(stationId: string): DisplaySettingsApi {
  const [settings, setSettings] = useState<KdsDisplaySettings>(() => readDisplaySettings(stationId));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const update = useCallback(
    (patch: Partial<KdsDisplaySettings>): void => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        saveDisplaySettings(stationId, next);
        return next;
      });
    },
    [stationId],
  );

  const resolvedSkin: 'light' | 'dark' =
    settings.skin === 'system' ? (systemDark ? 'dark' : 'light') : settings.skin;

  const style = useMemo<CSSProperties>(
    () => ({
      '--kds-card-min': `${Math.round(320 * settings.cardScale)}px`,
      '--kds-fs':
        settings.density === 'compact' ? '0.87' : settings.density === 'light' ? '1.14' : '1',
      '--kds-queue-fs': String(settings.queueScale),
    }) as CSSProperties,
    [settings.cardScale, settings.density, settings.queueScale],
  );

  return { settings, update, resolvedSkin, style };
}
