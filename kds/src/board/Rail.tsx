import type { KdsRecentActionDto } from '@menuboard/shared';
import { QUEUE_SCALE_MAX, QUEUE_SCALE_MIN, QUEUE_SCALE_STEP } from '../config/displaySettings';

/**
 * The queue: what the counter still owes, one row per item, SN / name / total quantity.
 *
 * A narrow centred column, deliberately: this is a list to be read across the room, not a
 * table to be scanned. `[-A] [+A]` on the header sets the type size for this screen and the
 * choice is saved per station, so a display three metres away keeps its larger setting.
 */
export function QueueGrid({
  summary,
  scale,
  onScaleChange,
}: {
  summary: { itemName: string; quantity: number }[];
  /** Undefined on read-only boards, which keep the default size and show no controls. */
  scale?: number;
  onScaleChange?: (next: number) => void;
}): JSX.Element {
  const total = summary.reduce((sum, row) => sum + row.quantity, 0);
  const current = scale ?? 1;
  const step = (delta: number): void => {
    if (onScaleChange === undefined) return;
    const next = Math.min(QUEUE_SCALE_MAX, Math.max(QUEUE_SCALE_MIN, current + delta));
    onScaleChange(Math.round(next * 100) / 100);
  };

  return (
    <section className="kds-queue">
      <div className="kds-queue__head">
        <h2>Queue</h2>
        <span>{total} item{total === 1 ? '' : 's'}</span>
        {onScaleChange !== undefined && (
          <div className="kds-queue__zoom" role="group" aria-label="Queue text size">
            <button
              type="button"
              onClick={() => step(-QUEUE_SCALE_STEP)}
              disabled={current <= QUEUE_SCALE_MIN}
              aria-label="Smaller queue text"
              title="Smaller text"
            >
              −A
            </button>
            <button
              type="button"
              onClick={() => step(QUEUE_SCALE_STEP)}
              disabled={current >= QUEUE_SCALE_MAX}
              aria-label="Bigger queue text"
              title="Bigger text"
            >
              +A
            </button>
          </div>
        )}
      </div>
      <div className="kds-queue__table" role="table" aria-label="Outstanding items">
        <div className="kds-queue__th">SN</div>
        <div className="kds-queue__th">Item name</div>
        <div className="kds-queue__th kds-queue__th--qty">Qty</div>
        {summary.length === 0 && <p className="kds-queue__empty">Nothing outstanding.</p>}
        {summary.map((row, index) => (
          <div key={row.itemName} style={{ display: 'contents' }} role="row">
            <div className="kds-queue__cell kds-queue__cell--sn">{index + 1}</div>
            <div className="kds-queue__cell kds-queue__cell--name">{row.itemName}</div>
            <div className="kds-queue__cell kds-queue__cell--qty">{row.quantity}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Compact header chips instead of a metrics block. */
export function MetricChips({
  pendingOrders,
  pendingLines,
  servedTodayOrders,
  avgServeSeconds,
  overdueLines,
}: {
  pendingOrders: number;
  pendingLines: number;
  servedTodayOrders: number;
  avgServeSeconds: number | null;
  overdueLines: number;
}): JSX.Element {
  return (
    <div className="kds-chips">
      <span className="kds-chip">
        <strong>{pendingOrders}</strong> orders
      </span>
      <span className="kds-chip">
        <strong>{pendingLines}</strong> items
      </span>
      <span className="kds-chip kds-chip--ok">
        <strong>{servedTodayOrders}</strong> served today
      </span>
      <span className="kds-chip">
        <strong>{avgServeSeconds === null ? '—' : `${Math.round(avgServeSeconds / 60)}m`}</strong> avg
      </span>
      <span className={`kds-chip ${overdueLines > 0 ? 'kds-chip--danger' : 'kds-chip--ok'}`}>
        <strong>{overdueLines}</strong> late
      </span>
    </div>
  );
}

/** Last serves, newest first, each with an undo — the mistake hatch. */
export function ServedDrawer({
  actions,
  busy,
  onRevert,
  onClose,
}: {
  actions: KdsRecentActionDto[];
  busy: boolean;
  onRevert: (lineId: string) => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <div className="kds-drawer__backdrop" onClick={onClose} />
      <aside className="kds-drawer" role="dialog" aria-label="Recently served">
        <div className="kds-drawer__head">
          <h2>Just served</h2>
          <button type="button" className="kds-served-row__undo" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="kds-drawer__list">
          {actions.length === 0 && (
            <p style={{ color: '#5d6675', fontSize: 13, padding: '14px 0' }}>
              Nothing served yet — served lines land here, newest first.
            </p>
          )}
          {actions.map((action) => (
            <div key={action.lineId} className="kds-served-row">
              <div className="kds-served-row__main">
                <p>
                  #{action.orderNumber} · {action.quantity}× {action.itemName}
                  {action.variantName ? ` (${action.variantName})` : ''}
                </p>
                <small>
                  {action.servedByName ?? 'counter'} · {new Date(action.servedAt).toLocaleTimeString()}
                </small>
              </div>
              <button
                type="button"
                className="kds-served-row__undo"
                disabled={busy}
                onClick={() => onRevert(action.lineId)}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
