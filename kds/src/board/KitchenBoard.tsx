import { useQuery } from '@tanstack/react-query';
import { LockKeyhole, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { fetchKdsConfig } from '../api/kds';
import { readErrorMessage } from '../api/client';
import { useDisplaySettings } from '../config/displaySettings';
import { readAway, saveAway, type AwayState, type StationSelection } from '../config/station';
import type { useQueue } from '../pages/BoardPage';
import { useNow } from './useNow';
import { OrderCard } from './OrderCard';
import { SettingsModal } from './SettingsModal';
import { useT } from '../i18n';

interface Props {
  station: StationSelection;
  queue: ReturnType<typeof useQueue>;
  onChangeStation: () => void;
  onSignOut: () => void;
  onLock: () => void;
}

/**
 * The kitchen's read-only mirror of its lines: the counter acknowledges and serves, the
 * kitchen watches the same deadlines. Nothing on this board mutates anything.
 */
export function KitchenBoard({ station, queue, onChangeStation, onSignOut, onLock }: Props): JSX.Element {
  const t = useT();
  const now = useNow();
  const display = useDisplaySettings(station.id);
  const config = useQuery({
    queryKey: ['kds', 'config'],
    queryFn: fetchKdsConfig,
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
  const orders = (queue.data?.orders ?? []).filter((order) =>
    order.lines.some((line) => line.kdsStatus !== 'SERVED'),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [away, setAway] = useState<AwayState>(() => readAway(station.id));

  const toggleAway = (): void => {
    setAway((prev) => {
      const next = { on: !prev.on, manual: !prev.on };
      saveAway(station.id, next);
      return next;
    });
  };

  return (
    <div className="kds-board" data-skin={display.resolvedSkin} style={display.style}>
      <header className="kds-topbar">
        <div className="kds-topbar__station">
          <h1>{station.name}</h1>
          <p>{t.kitchenBoardSubtitle}</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button type="button" className="kds-topbar__btn" onClick={onLock} title={t.lockScreen}>
            <LockKeyhole className="size-4" />
          </button>
          <button
            type="button"
            className="kds-topbar__btn"
            onClick={() => setSettingsOpen(true)}
            aria-label={t.displaySettings}
          >
            <SettingsIcon className="size-4" />
          </button>
        </div>
      </header>

      <div className="kds-board__body">
        <main className="kds-cards">
          {queue.isPending && <p style={{ color: 'var(--kds-soft)' }}>{t.loadingBoard}</p>}
          {queue.error !== null && (
            <p style={{ color: 'var(--kds-late)' }}>{readErrorMessage(queue.error, t.boardLoadFailed)}</p>
          )}
          {queue.isFetched && orders.length === 0 && (
            <p style={{ color: 'var(--kds-faint)', fontSize: 18 }}>{t.nothingForKitchen}</p>
          )}
          {orders.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              config={config.data}
              now={now}
              isNew={false}
              readOnly
              busy={false}
              onAcknowledge={() => undefined}
              onServe={() => undefined}
              onUndo={() => undefined}
              onServeAll={() => undefined}
              onExchange={() => undefined}
            />
          ))}
        </main>
      </div>

      {settingsOpen && (
        <SettingsModal
          display={display}
          outOfStation={away.on}
          onToggleOutOfStation={toggleAway}
          onLock={() => {
            setSettingsOpen(false);
            onLock();
          }}
          onChangeStation={() => {
            setSettingsOpen(false);
            onChangeStation();
          }}
          onSignOut={() => {
            setSettingsOpen(false);
            onSignOut();
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
