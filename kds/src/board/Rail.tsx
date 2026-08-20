import { useCallback, useRef } from 'react';
import type { KdsQueueSummaryRow, KdsRecentActionDto } from '@menuboard/shared';
import { QUEUE_SCALE_MAX, QUEUE_SCALE_MIN, QUEUE_SCALE_STEP } from '../config/displaySettings';
import { pickName, useLang, useT } from '../i18n';

export interface QueueBoxSize {
  width: number;
  height: number;
}

/**
 * The queue: what the counter still owes, one row per dish — serial number, name, how many are
 * owed, and how many are left in hand.
 *
 * A narrow centred column, deliberately: this is a list read across the room, not a table to be
 * scanned. `−A / +A` sets the type size and the corner handle sets the box size; both are saved
 * per station, because a screen three metres away needs different numbers from one on a shelf.
 */
export function QueueGrid({
  summary,
  scale,
  onScaleChange,
  size,
  onSizeChange,
}: {
  summary: KdsQueueSummaryRow[];
  /** Undefined on read-only boards, which keep the default size and show no controls. */
  scale?: number;
  onScaleChange?: (next: number) => void;
  size?: QueueBoxSize;
  onSizeChange?: (next: QueueBoxSize) => void;
}): JSX.Element {
  const t = useT();
  const { lang } = useLang();
  const total = summary.reduce((sum, row) => sum + row.quantity, 0);
  const current = scale ?? 1;
  const boxRef = useRef<HTMLElement | null>(null);

  const step = (delta: number): void => {
    if (onScaleChange === undefined) return;
    const next = Math.min(QUEUE_SCALE_MAX, Math.max(QUEUE_SCALE_MIN, current + delta));
    onScaleChange(Math.round(next * 100) / 100);
  };

  /** Drag the corner: width and height together, clamped to something still usable. */
  const onResizeStart = useCallback(
    (event: React.PointerEvent) => {
      if (onSizeChange === undefined || boxRef.current === null) return;
      event.preventDefault();
      const box = boxRef.current.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;

      const onMove = (move: PointerEvent): void => {
        onSizeChange({
          width: Math.max(320, Math.round(box.width + (move.clientX - startX))),
          height: Math.max(220, Math.round(box.height + (move.clientY - startY))),
        });
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [onSizeChange],
  );

  return (
    <section
      ref={boxRef}
      className="kds-queue"
      style={
        size === undefined
          ? undefined
          : { width: size.width, height: size.height, maxWidth: '100%', margin: '0 auto' }
      }
    >
      <div className="kds-queue__head">
        <h2>{t.queue}</h2>
        <span>{t.queueItems(total)}</span>
        {onScaleChange !== undefined && (
          <div className="kds-queue__zoom" role="group" aria-label={t.textSize}>
            <button
              type="button"
              onClick={() => step(-QUEUE_SCALE_STEP)}
              disabled={current <= QUEUE_SCALE_MIN}
              aria-label={t.smallerText}
              title={t.smallerText}
            >
              −A
            </button>
            <button
              type="button"
              onClick={() => step(QUEUE_SCALE_STEP)}
              disabled={current >= QUEUE_SCALE_MAX}
              aria-label={t.biggerText}
              title={t.biggerText}
            >
              +A
            </button>
          </div>
        )}
      </div>

      <div className="kds-queue__table" role="table" aria-label={t.queue}>
        <div className="kds-queue__th">{t.colSn}</div>
        <div className="kds-queue__th">{t.colItemName}</div>
        <div className="kds-queue__th kds-queue__th--qty">{t.colQty}</div>
        <div className="kds-queue__th kds-queue__th--qty">{t.colInHand}</div>
        {summary.length === 0 && <p className="kds-queue__empty">{t.nothingOutstanding}</p>}
        {summary.map((row, index) => (
          <div key={row.menuItemId ?? row.itemName} style={{ display: 'contents' }} role="row">
            <div className="kds-queue__cell kds-queue__cell--sn">{index + 1}</div>
            <div className="kds-queue__cell kds-queue__cell--name">
            {pickName(lang, row.itemName, row.itemNameHi)}
          </div>
            <div className="kds-queue__cell kds-queue__cell--qty">{row.quantity}</div>
            <div
              className={[
                'kds-queue__cell',
                'kds-queue__cell--hand',
                row.remainingQty === 0 ? 'kds-queue__cell--hand-empty' : '',
                row.remainingQty !== null && row.remainingQty < row.quantity
                  ? 'kds-queue__cell--hand-short'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {/* A dash is not zero: nobody has counted this dish for the shift. */}
              {row.remainingQty === null ? '—' : row.remainingQty}
            </div>
          </div>
        ))}
      </div>

      {onSizeChange !== undefined && (
        <div
          className="kds-queue__resize"
          onPointerDown={onResizeStart}
          role="separator"
          aria-label={t.resizeQueue}
          title={t.resizeQueue}
        />
      )}
    </section>
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
  const t = useT();
  const { lang } = useLang();
  return (
    <>
      <div className="kds-drawer__backdrop" onClick={onClose} />
      <aside className="kds-drawer" role="dialog" aria-label={t.tabCompleted}>
        <div className="kds-drawer__head">
          <h2>{t.tabCompleted}</h2>
          <button type="button" className="kds-served-row__undo" onClick={onClose}>
            {t.close}
          </button>
        </div>
        <div className="kds-drawer__list">
          {actions.length === 0 && (
            <p style={{ color: 'var(--kds-faint)', fontSize: 13, padding: '14px 0' }}>
              {t.nothingServedYet}
            </p>
          )}
          {actions.map((action) => (
            <div key={action.lineId} className="kds-served-row">
              <div className="kds-served-row__main">
                <p>
                  #{action.orderNumber} · {action.quantity}×{' '}
                  {pickName(lang, action.itemName, action.itemNameHi)}
                  {action.variantName ? ` (${action.variantName})` : ''}
                </p>
                <small>
                  {action.servedByName ?? ''} · {new Date(action.servedAt).toLocaleTimeString()}
                </small>
              </div>
              <button
                type="button"
                className="kds-served-row__undo"
                disabled={busy}
                onClick={() => onRevert(action.lineId)}
              >
                {t.revert}
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
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
  const t = useT();
  return (
    <div className="kds-chips">
      <span className="kds-chip">
        <strong>{pendingOrders}</strong> {t.chipOrders}
      </span>
      <span className="kds-chip">
        <strong>{pendingLines}</strong> {t.chipItems}
      </span>
      <span className="kds-chip kds-chip--ok">
        <strong>{servedTodayOrders}</strong> {t.chipServedToday}
      </span>
      <span className="kds-chip">
        <strong>{avgServeSeconds === null ? '—' : `${Math.round(avgServeSeconds / 60)}m`}</strong>{' '}
        {t.chipAvg}
      </span>
      <span className={`kds-chip ${overdueLines > 0 ? 'kds-chip--danger' : 'kds-chip--ok'}`}>
        <strong>{overdueLines}</strong> {t.chipLate}
      </span>
    </div>
  );
}
