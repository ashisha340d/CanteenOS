import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import {
  actionIcons,
  conceptIcons,
  moduleIcons,
  statusIcons,
  STATUS_TONE,
  type ActionName,
  type AppIcon,
  type StatusName,
} from '@/theme/fluentIcons';
import { moduleColor } from '@/theme/moduleColors';

/**
 * The four components every icon in the product goes through.
 *
 * The point is not convenience, it is that a call site cannot express the wrong thing. Asking
 * for `<ActionIcon name="edit" />` gives you the one edit glyph at the one toolbar size; there
 * is no parameter for "a different edit icon", and no `className` full of `h-[17px]` for a
 * module to drift on. That is what keeps twenty-odd forms looking like one application.
 *
 * Sizes are a closed set for the same reason. Fluent's glyphs are drawn on a 20/24px grid, so
 * these four are the sizes at which the strokes land on whole pixels instead of blurring.
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<IconSize, string> = {
  xs: 'size-3.5',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-8',
};

export interface FluentIconProps {
  icon: AppIcon;
  size?: IconSize;
  className?: string;
  /** Carries the tint from ModuleIcon/StatusIcon. Forwarded, or those props do nothing. */
  style?: CSSProperties;
  /**
   * The accessible name. Omit it for an icon that merely decorates a label that already says
   * the same thing — it is then hidden from assistive tech rather than read out twice.
   */
  label?: string;
}

/**
 * The base. Everything else here is a thin wrapper that decides *which* glyph, then defers.
 *
 * `shrink-0` is not incidental: these sit in flex rows next to text that can be long, and
 * without it a flex parent squashes the glyph into an ellipse. That single class is most of
 * what "icons must not become distorted when resized" means in practice.
 */
export function FluentIcon({
  icon: Icon,
  size = 'sm',
  className,
  style,
  label,
}: FluentIconProps): JSX.Element {
  return (
    <Icon
      className={cn(SIZE_CLASS[size], 'shrink-0', className)}
      {...(style === undefined ? {} : { style })}
      {...(label === undefined
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': label })}
    />
  );
}

/* ------------------------------------------------------------------------- modules */

export interface ModuleIconProps {
  /** A `DesktopApp.id`, or a key from the concept registry (`sales`, `gst`, `reports`). */
  module: string;
  size?: IconSize;
  /** Filled reads as an object and is what the launcher tiles use; regular reads as a control. */
  variant?: 'regular' | 'filled';
  /** Paint the glyph in the module's own category colour rather than inheriting the text ink. */
  tinted?: boolean;
  className?: string;
  label?: string;
}

/**
 * A module's own mark. Unknown ids fall back to the settings cog rather than rendering nothing,
 * so a module added to the registry without an icon is visibly wrong instead of invisibly so.
 */
export function ModuleIcon({
  module,
  size = 'sm',
  variant = 'regular',
  tinted = false,
  className,
  label,
}: ModuleIconProps): JSX.Element {
  const pair = moduleIcons[module];
  const concept = conceptIcons[module];
  const Icon: AppIcon = pair ? pair[variant] : (concept ?? moduleIcons.settings!.regular);
  return (
    <FluentIcon
      icon={Icon}
      size={size}
      className={className}
      {...(label === undefined ? {} : { label })}
      {...(tinted ? { style: { color: moduleColor(module) } } : {})}
    />
  );
}

/**
 * The launcher tile: the module's filled glyph on a filled square of its category colour.
 *
 * This is the one place colour is used at full strength, because a launcher is scanned rather
 * than read — an operator finds Purchase Entry by its orange before the label resolves.
 */
export function ModuleTile({
  module,
  size = 'lg',
  className,
  label,
}: {
  module: string;
  size?: IconSize;
  className?: string;
  label?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-[6px] text-white',
        size === 'xl' ? 'size-11' : size === 'lg' ? 'size-8' : 'size-6',
        className,
      )}
      style={{ background: moduleColor(module) }}
    >
      <ModuleIcon
        module={module}
        variant="filled"
        size={size === 'xl' ? 'lg' : size === 'lg' ? 'md' : 'sm'}
        {...(label === undefined ? {} : { label })}
      />
    </span>
  );
}

/* ------------------------------------------------------------------------- actions */

export interface ActionIconProps {
  name: ActionName;
  size?: IconSize;
  className?: string;
  label?: string;
}

/**
 * A verb. Deliberately has no way to override the glyph: Edit is the same drawing in the menu
 * master, the purchase register and the user list, and that is enforced here rather than
 * remembered by whoever writes the next toolbar.
 */
export function ActionIcon({
  name,
  size = 'sm',
  className,
  label,
}: ActionIconProps): JSX.Element {
  return (
    <FluentIcon
      icon={actionIcons[name]}
      size={size}
      className={className}
      {...(label === undefined ? {} : { label })}
    />
  );
}

/* -------------------------------------------------------------------------- status */

export interface StatusIconProps {
  name: StatusName;
  size?: IconSize;
  /** Filled by default — a state is a signal, not something to press. */
  variant?: 'regular' | 'filled';
  /** Off for a glyph that sits inside an already-coloured badge and should inherit its ink. */
  toned?: boolean;
  className?: string;
  label?: string;
}

export function StatusIcon({
  name,
  size = 'sm',
  variant = 'filled',
  toned = true,
  className,
  label,
}: StatusIconProps): JSX.Element {
  return (
    <FluentIcon
      icon={statusIcons[name][variant]}
      size={size}
      className={className}
      {...(label === undefined ? {} : { label })}
      {...(toned ? { style: { color: STATUS_TONE[name] } } : {})}
    />
  );
}
