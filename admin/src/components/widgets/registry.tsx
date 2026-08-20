import type { ComponentType } from 'react';
import {
  BarChart3Icon,
  ClockIcon,
  ReceiptIndianRupeeIcon,
  SoupIcon,
  TrophyIcon,
} from 'lucide-react';
import type { WindowIcon } from '@/services/WindowManager';
import { ActiveMenusWidget } from './ActiveMenusWidget';
import { BusyHoursWidget } from './BusyHoursWidget';
import { ClockWidget } from './ClockWidget';
import { SalesWidget } from './SalesWidget';
import { TopItemsWidget } from './TopItemsWidget';
import type { WidgetBodyProps } from './widgetTypes';
import type { WidgetOptions } from './widgetState';

/**
 * Every widget Canteen OS can put on a surface. The single source of truth for the desktop's
 * right-click menu, the Settings list and what a surface actually renders — adding an entry
 * here makes it available everywhere, exactly as `appRegistry` does for modules.
 *
 * A `Body` is pure content and knows nothing about being dragged: the frame, the placement and
 * the persistence are `DockableWidget`'s business, which is what lets the same component be
 * rendered inside a settings page or a form just as happily as on the desktop.
 */

export interface WidgetSwitchDefinition {
  key: string;
  /** Shown on the adjust-mode chip, so it has to be one or two words. */
  label: string;
  on: boolean;
}

export interface WidgetDefinition {
  id: string;
  label: string;
  /** Shown in the picker. Says what the widget is for, not what it looks like. */
  description: string;
  Icon: WindowIcon;
  accent: string;
  /** Opening size, and the smallest it may usefully be dragged to. */
  size: { w: number; h: number };
  min: { w: number; h: number };
  /** Display switches offered when the card is long-pressed. */
  switches?: WidgetSwitchDefinition[];
  Body: ComponentType<WidgetBodyProps>;
}

export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'clock',
    label: 'Clock',
    description:
      'The time and date, and — switchable on the card itself — the weather over the counter and the next public holidays.',
    Icon: ClockIcon,
    accent: '#5b4ff5',
    size: { w: 268, h: 330 },
    min: { w: 220, h: 130 },
    switches: [
      { key: 'weather', label: 'Weather', on: true },
      { key: 'holidays', label: 'Holidays', on: true },
    ],
    Body: ClockWidget,
  },
  {
    id: 'active-menus',
    label: 'Active menus',
    description:
      'Which menus the counter is serving from right now, how long each has left, and what opens next today.',
    Icon: SoupIcon,
    accent: '#0f766e',
    size: { w: 280, h: 240 },
    min: { w: 240, h: 170 },
    Body: ActiveMenusWidget,
  },
  {
    id: 'sales',
    label: 'Sales',
    description: 'Takings for a period against the period before it, with bills and averages.',
    Icon: ReceiptIndianRupeeIcon,
    accent: '#0e9f6e',
    size: { w: 270, h: 260 },
    min: { w: 240, h: 220 },
    Body: SalesWidget,
  },
  {
    id: 'top-items',
    label: 'Top selling items',
    description: 'What is earning, ranked by share of takings rather than by count.',
    Icon: TrophyIcon,
    accent: '#d08511',
    size: { w: 290, h: 280 },
    min: { w: 250, h: 200 },
    Body: TopItemsWidget,
  },
  {
    id: 'busy-hours',
    label: 'Busy hours',
    description: 'Trade by hour of the day — bills or money — so counters can be staffed to it.',
    Icon: BarChart3Icon,
    accent: '#7c3aed',
    size: { w: 340, h: 250 },
    min: { w: 280, h: 210 },
    Body: BusyHoursWidget,
  },
];

export function findWidget(id: string): WidgetDefinition | undefined {
  return WIDGETS.find((widget) => widget.id === id);
}

/** A widget's switches as a plain map, for merging the stored overrides over. */
export function defaultOptions(definition: WidgetDefinition): WidgetOptions {
  return Object.fromEntries(
    (definition.switches ?? []).map((option) => [option.key, option.on]),
  );
}
