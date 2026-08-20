import type { ComponentType } from 'react';
import {
  BarChart3Icon,
  CalendarDaysIcon,
  ClockIcon,
  CloudSunIcon,
  ReceiptIndianRupeeIcon,
  TrophyIcon,
} from 'lucide-react';
import type { WindowIcon } from '@/services/WindowManager';
import { BusyHoursWidget } from './BusyHoursWidget';
import { CalendarWidget } from './CalendarWidget';
import { ClockWidget } from './ClockWidget';
import { SalesWidget } from './SalesWidget';
import { TopItemsWidget } from './TopItemsWidget';
import { WeatherWidget } from './WeatherWidget';

/**
 * Every widget Canteen OS can put on a surface. The single source of truth for the "Add
 * widget" menu, the Settings list and what a surface actually renders — adding an entry here
 * makes it available everywhere, exactly as `appRegistry` does for modules.
 *
 * A `Body` is pure content. It is handed no props and knows nothing about being dragged: the
 * frame, the placement and the persistence are `DockableWidget`'s business, which is what
 * lets the same component be rendered inside a settings page or a report just as happily as
 * on the desktop.
 */
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
  Body: ComponentType;
}

export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'clock',
    label: 'Clock & date',
    description: 'The time, the day and the date, at a size readable across the room.',
    Icon: ClockIcon,
    accent: '#5b4ff5',
    size: { w: 240, h: 172 },
    min: { w: 200, h: 140 },
    Body: ClockWidget,
  },
  {
    id: 'calendar',
    label: 'Calendar & holidays',
    description: 'The month with public holidays marked on it, for planning the roster.',
    Icon: CalendarDaysIcon,
    accent: '#2570da',
    size: { w: 280, h: 330 },
    min: { w: 240, h: 260 },
    Body: CalendarWidget,
  },
  {
    id: 'weather',
    label: 'Weather',
    description: 'Conditions over the counter now, and the three days after.',
    Icon: CloudSunIcon,
    accent: '#0891b2',
    size: { w: 250, h: 250 },
    min: { w: 220, h: 210 },
    Body: WeatherWidget,
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
