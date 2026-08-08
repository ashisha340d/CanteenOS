/**
 * Six status tones, deliberately not one per status. Statuses map onto meaning — waiting,
 * moving, done, stopped — so the interface never becomes a rainbow of near-identical hues.
 *
 * The colours themselves live in index.css as CSS custom properties, once per skin. What
 * lives here is the mapping from tone name to whole Tailwind class strings: they must be
 * written out in full because Tailwind scans source statically and would never emit a class
 * assembled at runtime like `bg-tone-${tone}-bg`.
 */

export type StatusToneName = 'neutral' | 'info' | 'progress' | 'success' | 'danger' | 'muted';

/** Foreground + tinted background + hairline border, for chips and badges. */
export const TONE_CHIP_CLASS: Record<StatusToneName, string> = {
  neutral: 'border-tone-neutral-border bg-tone-neutral-bg text-tone-neutral',
  info: 'border-tone-info-border bg-tone-info-bg text-tone-info',
  progress: 'border-tone-progress-border bg-tone-progress-bg text-tone-progress',
  success: 'border-tone-success-border bg-tone-success-bg text-tone-success',
  danger: 'border-tone-danger-border bg-tone-danger-bg text-tone-danger',
  muted: 'border-tone-muted-border bg-tone-muted-bg text-tone-muted',
};

/** The solid dot/ribbon colour, used where a full chip would be too heavy. */
export const TONE_DOT_CLASS: Record<StatusToneName, string> = {
  neutral: 'bg-tone-neutral-solid',
  info: 'bg-tone-info-solid',
  progress: 'bg-tone-progress-solid',
  success: 'bg-tone-success-solid',
  danger: 'bg-tone-danger-solid',
  muted: 'bg-tone-muted-solid',
};

/** Foreground colour alone, for numbers and icons that carry their own weight. */
export const TONE_TEXT_CLASS: Record<StatusToneName, string> = {
  neutral: 'text-tone-neutral',
  info: 'text-tone-info',
  progress: 'text-tone-progress',
  success: 'text-tone-success',
  danger: 'text-tone-danger',
  muted: 'text-tone-muted',
};

/** Tinted background alone, for icon plates and emphasis washes. */
export const TONE_BG_CLASS: Record<StatusToneName, string> = {
  neutral: 'bg-tone-neutral-bg',
  info: 'bg-tone-info-bg',
  progress: 'bg-tone-progress-bg',
  success: 'bg-tone-success-bg',
  danger: 'bg-tone-danger-bg',
  muted: 'bg-tone-muted-bg',
};

export const TONE_BORDER_CLASS: Record<StatusToneName, string> = {
  neutral: 'border-tone-neutral-border',
  info: 'border-tone-info-border',
  progress: 'border-tone-progress-border',
  success: 'border-tone-success-border',
  danger: 'border-tone-danger-border',
  muted: 'border-tone-muted-border',
};
