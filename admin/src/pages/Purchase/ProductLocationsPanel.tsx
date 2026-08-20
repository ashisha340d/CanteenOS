import { useMemo, useState } from 'react';
import {
  InventoryLocationKind,
  MasterStatus,
  STOCK_HOLDING_LOCATION_KINDS,
  type ProductLocationDto,
} from '@menuboard/shared';
import { PlusIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NumberField, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { DeleteAction, EditAction, RowActions } from '@/components/RowActions';
import {
  useDeleteProductLocation,
  useInventoryLocations,
  useProductLocations,
  useUpsertProductLocation,
} from '../../hooks/usePurchase';
import { readError } from '../../services/errorMessage';
import { humanise, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

interface DraftValues {
  locationId: string;
  bin: string;
  minStock: string;
  reorderLevel: string;
  maxStock: string;
  isDefaultDestination: boolean;
}

const EMPTY_DRAFT: DraftValues = {
  locationId: '',
  bin: '',
  minStock: '',
  reorderLevel: '',
  maxStock: '',
  isDefaultDestination: false,
};

/** Blank means "no policy at this location", which is not the same number as zero. */
const optionalNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const show = (value: number | null): string => (value === null ? '—' : String(value));

/**
 * Per-location stock policy for one product.
 *
 * The product carries a single reorder level for the business as a whole; this is where the
 * warehouse's level is separated from the kitchen's, which is the pair a store manager
 * actually orders against.
 */
export function ProductLocationsPanel({
  productId,
  canWrite,
}: {
  productId: string;
  canWrite: boolean;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = useProductLocations(productId);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const upsert = useUpsertProductLocation(productId);
  const remove = useDeleteProductLocation(productId);

  const [draft, setDraft] = useState<DraftValues | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);

  /** A location already on the list is edited in place rather than mapped a second time. */
  const availableLocations = useMemo(() => {
    const taken = new Set(rows.map((row) => row.locationId));
    return (locations?.items ?? []).filter(
      (location) =>
        location.kind !== InventoryLocationKind.DIRECT_CONSUMPTION &&
        (!taken.has(location.id) || location.id === draft?.locationId),
    );
  }, [locations?.items, rows, draft?.locationId]);

  function startAdd(): void {
    setEditingId(null);
    setError(null);
    setDraft({ ...EMPTY_DRAFT });
  }

  function startEdit(row: ProductLocationDto): void {
    setEditingId(row.id);
    setError(null);
    setDraft({
      locationId: row.locationId,
      bin: row.bin ?? '',
      minStock: row.minStock === null ? '' : String(row.minStock),
      reorderLevel: row.reorderLevel === null ? '' : String(row.reorderLevel),
      maxStock: row.maxStock === null ? '' : String(row.maxStock),
      isDefaultDestination: row.isDefaultDestination,
    });
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setError(null);
    if (!draft.locationId) {
      setError('Choose a location.');
      return;
    }
    const min = optionalNumber(draft.minStock);
    const max = optionalNumber(draft.maxStock);
    if (min !== null && max !== null && max < min) {
      setError('Maximum stock cannot be below minimum stock.');
      return;
    }

    try {
      await upsert.mutateAsync({
        productId,
        locationId: draft.locationId,
        minStock: min,
        reorderLevel: optionalNumber(draft.reorderLevel),
        maxStock: max,
        isDefaultDestination: draft.isDefaultDestination,
        bin: draft.bin || null,
      });
      notify.success('Location policy saved.');
      setDraft(null);
      setEditingId(null);
    } catch (err) {
      setError(readError(err).message);
    }
  }

  async function removeRow(row: ProductLocationDto): Promise<void> {
    try {
      await remove.mutateAsync(row.locationId);
      notify.success('Location policy removed.');
    } catch (err) {
      notify.fromError(err);
    }
  }

  return (
    <section className="bg-card rounded-xl border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-semibold">Stock policy by location</h3>
          <p className="text-muted-foreground text-xs">
            Overrides the product-wide levels for one store. Direct-consumption locations are
            excluded — they never hold a balance.
          </p>
        </div>
        {canWrite && (
          <Button type="button" variant="outline" size="sm" onClick={startAdd} disabled={Boolean(draft)}>
            <PlusIcon data-icon="inline-start" />
            Add location
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }, (_unused, index) => (
            <Skeleton key={index} className="h-8 rounded-md" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <p className="text-sm font-medium">Location policy could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 && !draft ? (
        <p className="text-muted-foreground py-4 text-sm">
          No per-location levels. The product-wide minimum, reorder and maximum apply everywhere.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-muted-foreground text-xs">
                <th className="pb-2 text-left font-normal">Location</th>
                <th className="pb-2 text-left font-normal">Bin</th>
                <th className="pb-2 text-right font-normal">Min</th>
                <th className="pb-2 text-right font-normal">Reorder</th>
                <th className="pb-2 text-right font-normal">Max</th>
                <th className="pb-2 text-left font-normal">Default</th>
                {canWrite && <th className="pb-2 text-right font-normal">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="py-1.5 pr-2">
                    <span className="flex items-center gap-1.5">
                      <span className="font-medium">{row.locationName ?? row.locationId}</span>
                      {row.locationKind &&
                        !STOCK_HOLDING_LOCATION_KINDS.includes(row.locationKind) && (
                          <Badge variant="outline">{humanise(row.locationKind)}</Badge>
                        )}
                    </span>
                  </td>
                  <td className="text-muted-foreground py-1.5 pr-2">{row.bin ?? '—'}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{show(row.minStock)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{show(row.reorderLevel)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{show(row.maxStock)}</td>
                  <td className="py-1.5 pr-2">
                    {row.isDefaultDestination ? (
                      <Badge variant="secondary">Default</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  {canWrite && (
                    <td className="py-1.5">
                      <RowActions>
                        <EditAction
                          label={row.locationName ?? 'location'}
                          disabled={Boolean(draft)}
                          onClick={() => startEdit(row)}
                        />
                        <DeleteAction
                          label={row.locationName ?? 'location'}
                          disabled={Boolean(draft) || remove.isPending}
                          onClick={() => void removeRow(row)}
                        />
                      </RowActions>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-dashed p-3">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SelectField
              label="Location"
              required
              disabled={editingId !== null}
              value={draft.locationId}
              onChange={(next) => setDraft({ ...draft, locationId: next })}
              options={toOptions(
                availableLocations,
                (location) => location.id,
                (location) => `${location.code} — ${location.name}`,
              )}
            />
            <TextField
              label="Bin"
              value={draft.bin}
              onChange={(e) => setDraft({ ...draft, bin: e.target.value })}
              maxLength={40}
              helperText="Shelf or rack reference inside the store."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumberField
              label="Minimum"
              value={draft.minStock}
              onChange={(e) => setDraft({ ...draft, minStock: e.target.value })}
              min={0}
              step="0.001"
            />
            <NumberField
              label="Reorder level"
              value={draft.reorderLevel}
              onChange={(e) => setDraft({ ...draft, reorderLevel: e.target.value })}
              min={0}
              step="0.001"
            />
            <NumberField
              label="Maximum"
              value={draft.maxStock}
              onChange={(e) => setDraft({ ...draft, maxStock: e.target.value })}
              min={0}
              step="0.001"
            />
          </div>

          <SwitchField
            label="Default destination"
            checked={draft.isDefaultDestination}
            onCheckedChange={(checked) => setDraft({ ...draft, isDefaultDestination: checked })}
            helperText="Where a receipt of this product lands unless the operator says otherwise."
          />

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(null);
                setEditingId(null);
                setError(null);
              }}
              disabled={upsert.isPending}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void save()} disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save location'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
