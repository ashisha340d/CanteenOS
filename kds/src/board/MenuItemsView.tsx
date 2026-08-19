import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, RotateCcw, UtensilsCrossed, X } from 'lucide-react';
import type { KdsStationMenuItemDto, KdsStationMenuUpsertRequest } from '@menuboard/shared';
import { fetchStationMenu, saveStationMenuItem } from '../api/kds';
import { API_ORIGIN, readErrorMessage } from '../api/client';
import type { StationSelection } from '../config/station';

interface Props {
  station: StationSelection;
}

/** Signed URLs carry the server's own origin; point them at the API this display reached. */
function mediaUrl(path: string | null): string | null {
  if (path === null || path === '') return null;
  if (!path.startsWith('http')) return `${API_ORIGIN}${path}`;
  try {
    const url = new URL(path);
    return `${API_ORIGIN}${url.pathname}${url.search}`;
  } catch {
    return path;
  }
}

/**
 * The station's menu file: what this counter is serving, what it has run out of, and how much
 * of each it has left.
 *
 * Three different scopes sit on one row, which is worth keeping straight:
 *  - the **name** is this screen's own label and nothing else's,
 *  - **finished** writes the menu's availability, so the dish leaves the Digital Menu Board
 *    until the next shift puts it back,
 *  - the **count** is this counter's stock for this shift; every sale deducts from it and zero
 *    finishes the dish by itself.
 */
export function MenuItemsView({ station }: Props): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [qtyId, setQtyId] = useState<string | null>(null);
  const [draftQty, setDraftQty] = useState('');

  const kind = station.mode === 'kitchen' ? 'kitchen' : 'counter';
  const menu = useQuery({
    queryKey: ['kds', 'station-menu', station.mode, station.id],
    queryFn: () => fetchStationMenu(kind, station.id),
    // Every change this screen makes invalidates the list itself. The timer is for a count spent
    // by sales elsewhere, which is a slow story — not something to poll twice a minute for.
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  const mutation = useMutation({
    mutationFn: ({ menuItemId, body }: { menuItemId: string; body: KdsStationMenuUpsertRequest }) =>
      saveStationMenuItem(kind, station.id, menuItemId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['kds', 'station-menu', station.mode, station.id] });
      void queryClient.invalidateQueries({ queryKey: ['kds', 'queue'] });
    },
  });

  const save = (menuItemId: string, body: KdsStationMenuUpsertRequest): void => {
    mutation.mutate({ menuItemId, body });
  };

  const items = useMemo(() => {
    const all = menu.data?.items ?? [];
    const needle = search.trim().toLowerCase();
    if (needle === '') return all;
    return all.filter(
      (item) =>
        item.displayName.toLowerCase().includes(needle) ||
        item.masterName.toLowerCase().includes(needle) ||
        item.categoryName.toLowerCase().includes(needle),
    );
  }, [menu.data, search]);

  const finishedCount = items.filter((item) => item.isFinished).length;

  const startRename = (item: KdsStationMenuItemDto): void => {
    setQtyId(null);
    setEditingId(item.menuItemId);
    setDraftName(item.displayName);
  };

  const commitRename = (item: KdsStationMenuItemDto, name: string | null): void => {
    setEditingId(null);
    if (name === item.displayName) return;
    save(item.menuItemId, { displayName: name });
  };

  const startQty = (item: KdsStationMenuItemDto): void => {
    setEditingId(null);
    setQtyId(item.menuItemId);
    setDraftQty(item.openingQty === null ? '' : String(item.openingQty));
  };

  const commitQty = (item: KdsStationMenuItemDto): void => {
    setQtyId(null);
    const trimmed = draftQty.trim();
    if (trimmed === '') {
      if (item.openingQty !== null) save(item.menuItemId, { openingQty: null });
      return;
    }
    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < 0) return;
    save(item.menuItemId, { openingQty: value });
  };

  return (
    <div className="kds-menu">
      <div className="kds-menu__toolbar">
        <input
          className="kds-menu__search"
          placeholder="Search this station's menu…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className="kds-menu__stat">
          {items.length} item{items.length === 1 ? '' : 's'}
          {finishedCount > 0 ? ` · ${finishedCount} finished` : ''}
          {menu.data !== undefined ? ` · ${menu.data.shift.toLowerCase()} shift` : ''}
        </span>
      </div>

      {menu.isPending && <p style={{ color: 'var(--kds-soft)' }}>Loading the menu file…</p>}
      {menu.error !== null && (
        <p style={{ color: 'var(--kds-late)' }}>{readErrorMessage(menu.error, 'Could not load the menu file.')}</p>
      )}
      {menu.isFetched && items.length === 0 && (
        <p style={{ color: 'var(--kds-faint)', fontSize: 15 }}>No dishes match.</p>
      )}

      {items.map((item) => {
        const image = mediaUrl(item.primaryMediaUrl);
        const renaming = editingId === item.menuItemId;
        const counting = qtyId === item.menuItemId;
        return (
          <div key={item.menuItemId} className={`kds-menu__card ${item.isFinished ? 'kds-menu__card--finished' : ''}`}>
            {image !== null ? (
              <img className="kds-menu__thumb" src={image} alt="" loading="lazy" />
            ) : (
              <div className="kds-menu__thumb kds-menu__thumb--empty">
                <UtensilsCrossed className="size-5" />
              </div>
            )}

            <div className="kds-menu__main">
              {/* The pencil sits on the name itself: tapping it turns the label into a field. */}
              {renaming ? (
                <form
                  className="kds-menu__rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    commitRename(item, draftName.trim() === '' ? null : draftName.trim());
                  }}
                >
                  <input
                    autoFocus
                    value={draftName}
                    placeholder={item.masterName}
                    maxLength={160}
                    onChange={(event) => setDraftName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                  />
                  <button type="submit" disabled={mutation.isPending} title="Save name">
                    <Check className="size-4" />
                  </button>
                  {item.hasCustomName && (
                    <button
                      type="button"
                      className="kds-menu__rename-clear"
                      disabled={mutation.isPending}
                      onClick={() => commitRename(item, null)}
                      title="Back to the master name"
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    className="kds-menu__rename-clear"
                    onClick={() => setEditingId(null)}
                    title="Cancel"
                  >
                    <X className="size-4" />
                  </button>
                </form>
              ) : (
                <p className="kds-menu__name">
                  <span>{item.displayName}</span>
                  <button
                    type="button"
                    className="kds-menu__pencil"
                    onClick={() => startRename(item)}
                    aria-label={`Rename ${item.displayName} on this screen`}
                    title="Rename on this screen"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                </p>
              )}

              <p className="kds-menu__meta">
                {item.categoryName}
                {item.hasCustomName ? ` · master: ${item.masterName}` : ''}
                {item.basePrice !== null ? ` · ₹${item.basePrice.toFixed(2)}` : ''}
              </p>

              <div className="kds-menu__tags">
                <button
                  type="button"
                  className={`kds-menu__stock ${item.isFinished ? 'kds-menu__stock--out' : 'kds-menu__stock--in'}`}
                  disabled={mutation.isPending}
                  onClick={() => save(item.menuItemId, { isFinished: !item.isFinished })}
                  title={
                    item.isFinished
                      ? 'Put it back — returns to the menu board too'
                      : 'Mark finished — leaves the menu board until the next shift'
                  }
                >
                  {item.isFinished ? 'Finished' : 'Available'}
                </button>

                {station.mode !== 'kitchen' &&
                  (counting ? (
                    <form
                      className="kds-menu__qty-edit"
                      onSubmit={(event) => {
                        event.preventDefault();
                        commitQty(item);
                      }}
                    >
                      <input
                        autoFocus
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder="qty in hand"
                        value={draftQty}
                        onChange={(event) => setDraftQty(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') setQtyId(null);
                        }}
                      />
                      <button type="submit" disabled={mutation.isPending} title="Register this count">
                        <Check className="size-4" />
                      </button>
                      <button type="button" onClick={() => setQtyId(null)} title="Cancel">
                        <X className="size-4" />
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className={`kds-menu__qty ${item.remainingQty === 0 ? 'kds-menu__qty--empty' : ''}`}
                      onClick={() => startQty(item)}
                      title="Register how many portions are in hand for this shift"
                    >
                      {item.openingQty === null ? (
                        'Set qty'
                      ) : (
                        <>
                          <strong>{item.remainingQty}</strong> left
                          <small>
                            of {item.openingQty}
                            {item.issuedQty > 0 ? ` · ${item.issuedQty} sold` : ''}
                          </small>
                        </>
                      )}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
