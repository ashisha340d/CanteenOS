import type { WidgetOptions } from './widgetState';

/**
 * What every widget body is handed. Its own display switches, already merged over the
 * registry's defaults — and nothing else. A body knows nothing about being dragged, docked or
 * persisted, which is what lets the same component render on the desktop, inside a module
 * page, or on a form.
 *
 * In its own module so the registry can import the widgets and the widgets can import this
 * type without the two ending up in a cycle.
 */
export interface WidgetBodyProps {
  options: WidgetOptions;
}
