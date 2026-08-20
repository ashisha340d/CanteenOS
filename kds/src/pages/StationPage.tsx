import { useQuery } from '@tanstack/react-query';
import { ChefHat, Loader2, LogOut, Monitor, Tv } from 'lucide-react';
import { listCounters, listKitchenGroups } from '../api/kds';
import { readErrorMessage } from '../api/client';
import { saveStation, type StationMode, type StationSelection } from '../config/station';
import { useT } from '../i18n';
import { LanguageSwitch } from '../components/LanguageSwitch';

interface Props {
  onSelect: (station: StationSelection) => void;
  onSignOut: () => void;
}

export function StationPage({ onSelect, onSignOut }: Props): JSX.Element {
  const t = useT();
  const counters = useQuery({ queryKey: ['kds', 'counters'], queryFn: listCounters });
  const groups = useQuery({ queryKey: ['kds', 'kitchen-groups'], queryFn: listKitchenGroups });

  // A link may pin the choice — the banner's CDS URL arrives as ?mode=cds.
  const modePin = (() => {
    const value = new URLSearchParams(window.location.search).get('mode');
    return value === 'counter' || value === 'kitchen' || value === 'cds' ? value : null;
  })();

  const pick = (mode: StationMode, id: string, name: string): void => {
    const station = { mode, id, name };
    saveStation(station);
    onSelect(station);
  };

  const failed = counters.error ?? groups.error;

  return (
    <div className="flex min-h-full flex-col gap-10 bg-canvas px-10 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl">{t.chooseStation}</h1>
          <p className="mt-2 text-lg text-ink-soft">{t.chooseStationHint}</p>
        </div>
        <div className="flex items-center gap-4">
          <LanguageSwitch />
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-2 rounded-lg bg-surface px-6 py-4 text-lg text-ink-soft active:bg-surface-raised"
          >
            <LogOut className="size-6" />
            {t.signOut}
          </button>
        </div>
      </header>

      {failed !== null && (
        <p className="text-lg text-danger">{readErrorMessage(failed, t.stationsFailed)}</p>
      )}

      {(counters.isPending || groups.isPending) && failed === null && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-10 animate-spin text-ink-soft" />
        </div>
      )}

      <div className="grid gap-10 lg:grid-cols-3">
        {(modePin === null || modePin === 'counter') && (
          <section className="flex flex-col gap-4">
            <h2 className="flex items-center gap-3 text-xl text-ink-soft">
              <Monitor className="size-7" />
              {t.counterDisplay}
            </h2>
            {(counters.data ?? []).map((counter) => (
              <button
                key={counter.id}
                type="button"
                onClick={() => pick('counter', counter.id, counter.name)}
                className="rounded-lg bg-surface px-6 py-6 text-left text-xl active:bg-surface-raised"
              >
                {counter.name}
              </button>
            ))}
            {counters.data !== undefined && counters.data.length === 0 && (
              <p className="text-base text-ink-faint">{t.noCounters}</p>
            )}
          </section>
        )}

        {(modePin === null || modePin === 'kitchen') && (
          <section className="flex flex-col gap-4">
            <h2 className="flex items-center gap-3 text-xl text-ink-soft">
              <ChefHat className="size-7" />
              {t.kitchenDisplay}
            </h2>
            {(groups.data ?? []).map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => pick('kitchen', group.id, group.name)}
                className="rounded-lg bg-surface px-6 py-6 text-left text-xl active:bg-surface-raised"
              >
                {group.name}
              </button>
            ))}
            {groups.data !== undefined && groups.data.length === 0 && (
              <p className="text-base text-ink-faint">{t.noKitchenGroups}</p>
            )}
          </section>
        )}

        {(modePin === null || modePin === 'cds') && (
          <section className="flex flex-col gap-4">
            <h2 className="flex items-center gap-3 text-xl text-ink-soft">
              <Tv className="size-7" />
              {t.customerDisplay}
            </h2>
            {(counters.data ?? []).map((counter) => (
              <button
                key={counter.id}
                type="button"
                onClick={() => pick('cds', counter.id, counter.name)}
                className="rounded-lg bg-surface px-6 py-6 text-left text-xl active:bg-surface-raised"
              >
                {counter.name}
              </button>
            ))}
            {counters.data !== undefined && counters.data.length === 0 && (
              <p className="text-base text-ink-faint">{t.noCounters}</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
