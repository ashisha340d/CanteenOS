import { useEffect, useRef, useState } from 'react';
import {
  LIMITS,
  MasterStatus,
  StockAdjustmentReason,
  StockAdjustmentStatus,
  type CreateStockAdjustmentLineRequest,
  type CreateStockAdjustmentRequest,
  type StockAdjustmentDto,
  type StockAdjustmentLineDto,
} from '@menuboard/shared';
import { LockIcon, Trash2Icon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FieldGroup, FieldRow, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { SearchPickerField } from '../../components/SearchPickerField';
import { StatusChip } from '../../components/StatusChip';
import { useInventoryLocations, useProducts } from '../../hooks/usePurchase';
import {
  useCreateStockAdjustment,
  useStockAdjustment,
  useStockBatches,
  useUpdateStockAdjustment,
} from '../../hooks/useStock';
import { readError } from '../../services/errorMessage';
import { enumOptions, humanise, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { dash, formatDate, money, qty } from './stockFormat';

const FORM_ID = 'stock-adjustment-form';

interface LineDraft {
  key: string;
  id?: string;
  productId: string;
  productLabel: string;
  productUnit: string;
  isBatchTracked: boolean;
  batchId: string;
  batchNumber: string;
  direction: 'IN' | 'OUT';
  quantity: string;
  unitCost: string;
  reason: string;
  notes: string;
}

interface HeaderValues {
  businessDate: string;
  locationId: string;
  reason: StockAdjustmentReason;
  notes: string;
}

/** The operator's own day, not UTC's — an adjustment is dated by the shift that raised it. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function blankHeader(): HeaderValues {
  return {
    businessDate: today(),
    locationId: '',
    reason: StockAdjustmentReason.CORRECTION,
    notes: '',
  };
}

function toDraft(line: StockAdjustmentLineDto): LineDraft {
  return {
    key: line.id,
    id: line.id,
    productId: line.productId,
    productLabel: line.productName ?? line.productId,
    productUnit: line.productUnit ?? '',
    isBatchTracked: line.batchId !== null,
    batchId: line.batchId ?? '',
    batchNumber: line.batchNumber ?? '',
    direction: line.direction,
    quantity: String(line.quantity),
    unitCost: String(line.unitCost),
    reason: line.reason ?? '',
    notes: line.notes ?? '',
  };
}

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Raising and posting a stock adjustment.
 *
 * A DRAFT is edited freely here; anything past it is shown read-only, because the lines are
 * what the ledger was written from and rewriting them after the fact would make the two
 * disagree. Cost is only the operator's to set on an IN line — stock leaves at the valuation
 * it is already held at.
 */
export function StockAdjustmentFormModal({
  open,
  adjustmentId,
  canWrite,
  onClose,
}: {
  open: boolean;
  adjustmentId: string | null;
  canWrite: boolean;
  onClose: () => void;
}): JSX.Element {
  const { data: doc, isLoading, isError, refetch } = useStockAdjustment(adjustmentId);
  const create = useCreateStockAdjustment();
  const update = useUpdateStockAdjustment();
  const submitting = create.isPending || update.isPending;

  const [header, setHeader] = useState<HeaderValues>(blankHeader);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const hydratedRef = useRef('');

  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: products, isFetching: productsFetching } = useProducts({
    search: productSearch || undefined,
    page: 1,
    pageSize: 20,
    stockedOnly: true,
    status: MasterStatus.ACTIVE,
  });

  useEffect(() => {
    if (!open) return;
    if (adjustmentId === null) {
      if (hydratedRef.current !== 'new') {
        hydratedRef.current = 'new';
        setHeader(blankHeader());
        setLines([]);
        setError(null);
      }
      return;
    }
    if (!doc) return;
    const token = `${doc.id}:${doc.revision}`;
    if (hydratedRef.current === token) return;
    hydratedRef.current = token;
    setHeader({
      businessDate: doc.businessDate.slice(0, 10),
      locationId: doc.locationId,
      reason: doc.reason,
      notes: doc.notes ?? '',
    });
    setLines((doc.lines ?? []).map(toDraft));
    setError(null);
  }, [open, adjustmentId, doc]);

  const posted = doc !== undefined && doc.status !== StockAdjustmentStatus.DRAFT;
  const readOnly = !canWrite || posted;

  function patchLine(key: string, patch: Partial<LineDraft>): void {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine(productId: string, label: string, unit: string, isBatchTracked: boolean): void {
    setLines((current) => [
      ...current,
      {
        key: `draft-${Date.now()}-${current.length}`,
        productId,
        productLabel: label,
        productUnit: unit,
        isBatchTracked,
        batchId: '',
        batchNumber: '',
        direction: 'OUT',
        quantity: '',
        unitCost: '',
        reason: '',
        notes: '',
      },
    ]);
  }

  function validate(): string | null {
    if (!header.locationId) return 'Choose the location the stock sits in.';
    if (lines.length === 0) return 'Add at least one line.';
    for (const [index, line] of lines.entries()) {
      const position = index + 1;
      if (!line.productId) return `Line ${position}: choose a product.`;
      if (!(num(line.quantity) > 0)) return `Line ${position}: the quantity must be above zero.`;
      if (line.direction === 'IN' && line.unitCost !== '' && num(line.unitCost) < 0) {
        return `Line ${position}: the unit cost cannot be negative.`;
      }
    }
    return null;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem !== null) return;

    const body: CreateStockAdjustmentRequest = {
      locationId: header.locationId,
      reason: header.reason,
      businessDate: header.businessDate || undefined,
      notes: header.notes || null,
      lines: lines.map((line): CreateStockAdjustmentLineRequest => ({
        ...(line.id === undefined ? {} : { id: line.id }),
        productId: line.productId,
        batchId: line.batchId || null,
        direction: line.direction,
        quantity: num(line.quantity),
        // Only an IN line carries a cost the operator chose; OUT is valued by the holding.
        ...(line.direction === 'IN' && line.unitCost !== ''
          ? { unitCost: num(line.unitCost) }
          : {}),
        reason: (line.reason || null) as StockAdjustmentReason | null,
        notes: line.notes || null,
      })),
    };

    try {
      if (doc) {
        await update.mutateAsync({
          id: doc.id,
          body: { ...body, expectedRevision: doc.revision },
        });
      } else {
        await create.mutateAsync(body);
      }
      notify.success('Adjustment saved as a draft.');
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  const title = doc
    ? `Adjustment ${doc.adjustmentNumber}`
    : adjustmentId === null
      ? 'New stock adjustment'
      : 'Stock adjustment';

  return (
    <Modal
      id="stock-adjustment-form"
      title={title}
      open={open}
      onClose={onClose}
      minWidth={980}
      minHeight={520}
      footer={
        readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <FormModalFooter
            formId={FORM_ID}
            onCancel={onClose}
            submitting={submitting}
            saveLabel="Save draft"
          />
        )
      }
    >
      {adjustmentId !== null && isLoading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 6 }, (_unused, index) => (
            <Skeleton key={index} className="h-9 rounded-md" />
          ))}
        </div>
      ) : adjustmentId !== null && isError ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-medium">This adjustment could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-5">
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {doc && <DocumentStrip doc={doc} />}

          {posted && (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <LockIcon className="size-3.5 shrink-0" aria-hidden />
              {doc?.status === StockAdjustmentStatus.POSTED
                ? 'Posted and immutable. Correct it by posting an opposite adjustment.'
                : 'Read-only: only a DRAFT adjustment can be edited.'}
            </p>
          )}

          <FieldGroup>
            <FieldRow>
              <SelectField
                label="Location"
                required
                disabled={readOnly}
                value={header.locationId}
                onChange={(next) => {
                  // Batches belong to a location; keeping the old picks would point at lots
                  // that are not in the new store.
                  setHeader({ ...header, locationId: next });
                  setLines((current) => current.map((line) => ({ ...line, batchId: '' })));
                }}
                options={toOptions(
                  locations?.items ?? [],
                  (location) => location.id,
                  (location) => `${location.code} — ${location.name}`,
                )}
                helperText="Where the stock being corrected physically sits."
              />
              <TextField
                label="Business date"
                type="date"
                disabled={readOnly}
                value={header.businessDate}
                onChange={(event) => setHeader({ ...header, businessDate: event.target.value })}
              />
            </FieldRow>

            <FieldRow>
              <SelectField
                label="Reason"
                required
                disabled={readOnly}
                value={header.reason}
                onChange={(next) =>
                  setHeader({ ...header, reason: next as StockAdjustmentReason })
                }
                options={enumOptions(StockAdjustmentReason)}
                helperText="The default for every line. A line may override it."
              />
              <TextField
                label="Notes"
                disabled={readOnly}
                value={header.notes}
                onChange={(event) => setHeader({ ...header, notes: event.target.value })}
                maxLength={LIMITS.PURCHASE_NOTES_MAX}
              />
            </FieldRow>
          </FieldGroup>

          <section className="flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3 border-b pb-1.5">
              <div>
                <h3 className="font-heading text-sm font-semibold">Lines</h3>
                <p className="text-muted-foreground text-xs">
                  Unit cost applies to IN lines only — stock leaves at the valuation it is held at.
                </p>
              </div>
              {!readOnly && (
                <div className="w-[300px] shrink-0">
                  <SearchPickerField
                    id="adjustment-add-product"
                    label="Add a product"
                    value={null}
                    displayValue=""
                    loading={productsFetching}
                    onSearchChange={setProductSearch}
                    options={(products?.items ?? []).map((product) => ({
                      id: product.id,
                      label: product.name,
                      sublabel: [product.code, product.stockUomCode ?? product.unit]
                        .filter(Boolean)
                        .join(' · '),
                    }))}
                    onSelect={(option) => {
                      const product = (products?.items ?? []).find(
                        (entry) => entry.id === option.id,
                      );
                      addLine(
                        option.id,
                        option.label,
                        product?.stockUomCode ?? product?.unit ?? '',
                        product?.isBatchTracked ?? false,
                      );
                    }}
                    disabled={header.locationId === ''}
                  />
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-muted-foreground py-4 text-sm">
                {readOnly
                  ? 'This adjustment has no lines.'
                  : header.locationId === ''
                    ? 'Choose a location, then add the products being corrected.'
                    : 'No lines yet. Search for a product above to add one.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead>
                    <tr className="text-muted-foreground text-xs">
                      <th className="pb-2 text-left font-normal">#</th>
                      <th className="pb-2 text-left font-normal">Product</th>
                      <th className="pb-2 text-left font-normal">Batch</th>
                      <th className="pb-2 text-left font-normal">Direction</th>
                      <th className="pb-2 text-right font-normal">Quantity</th>
                      <th className="pb-2 text-right font-normal">Unit cost</th>
                      <th className="pb-2 text-right font-normal">Value</th>
                      <th className="pb-2 text-left font-normal">Reason</th>
                      <th className="pb-2 text-left font-normal">Notes</th>
                      {!readOnly && <th className="pb-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, index) => (
                      <AdjustmentLineRow
                        key={line.key}
                        line={line}
                        index={index}
                        locationId={header.locationId}
                        readOnly={readOnly}
                        headerReason={header.reason}
                        onChange={(patch) => patchLine(line.key, patch)}
                        onRemove={() =>
                          setLines((current) =>
                            current.filter((entry) => entry.key !== line.key),
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </form>
      )}
    </Modal>
  );
}

/** What the document already is: its status, who moved it along, and what it totalled. */
function DocumentStrip({ doc }: { doc: StockAdjustmentDto }): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 text-xs">
      <StatusChip status={doc.status} />
      <span className="text-muted-foreground">
        {dash(doc.locationName)} · {formatDate(doc.businessDate)}
      </span>
      <Badge variant="outline">{humanise(doc.reason)}</Badge>
      <span className="text-muted-foreground tabular-nums">
        {money(doc.totalInValue)} in · {money(doc.totalOutValue)} out
      </span>
      {doc.createdByName ? (
        <span className="text-muted-foreground">Raised by {doc.createdByName}</span>
      ) : null}
      {doc.postedByName ? (
        <span className="text-muted-foreground">Posted by {doc.postedByName}</span>
      ) : null}
      {doc.stockCountId !== null && <Badge variant="secondary">From a stock count</Badge>}
    </div>
  );
}

/**
 * One line of the grid. Its own component because the batch list is per product ⋅ location,
 * and a hook cannot be called in a loop.
 */
function AdjustmentLineRow({
  line,
  index,
  locationId,
  readOnly,
  headerReason,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  locationId: string;
  readOnly: boolean;
  headerReason: StockAdjustmentReason;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}): JSX.Element {
  const showBatch = line.isBatchTracked || line.batchId !== '';
  const { data: batches } = useStockBatches(
    { productId: line.productId, locationId, onHandOnly: true, page: 1, pageSize: 100 },
    !readOnly && showBatch && line.productId !== '' && locationId !== '',
  );

  const quantity = Number(line.quantity);
  const cost = Number(line.unitCost);
  const lineValue =
    Number.isFinite(quantity) && Number.isFinite(cost) && line.unitCost !== ''
      ? quantity * cost
      : null;

  return (
    <tr className="border-t align-middle">
      <td className="text-muted-foreground py-1.5 pr-2 tabular-nums">{index + 1}</td>
      <td className="py-1.5 pr-2">
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{line.productLabel}</span>
          {line.productUnit !== '' && (
            <span className="text-muted-foreground text-xs">in {line.productUnit}</span>
          )}
        </span>
      </td>
      <td className="py-1.5 pr-2">
        {!showBatch ? (
          <span className="text-muted-foreground">—</span>
        ) : readOnly ? (
          <span>{dash(line.batchNumber)}</span>
        ) : (
          <Select
            value={line.batchId}
            onValueChange={(next) => onChange({ batchId: next })}
          >
            <SelectTrigger size="sm" className="w-[150px]" aria-label={`Batch for line ${index + 1}`}>
              <SelectValue placeholder="Any batch" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {(batches?.items ?? []).map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {batch.batchNumber ?? batch.id.slice(0, 8)}
                    {batch.quantityOnHand === undefined
                      ? ''
                      : ` · ${qty(batch.quantityOnHand)} on hand`}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="py-1.5 pr-2">
        {readOnly ? (
          <Badge variant={line.direction === 'IN' ? 'secondary' : 'outline'}>
            {line.direction}
          </Badge>
        ) : (
          <Select
            value={line.direction}
            onValueChange={(next) =>
              onChange({
                direction: next as 'IN' | 'OUT',
                // An OUT line has no operator-set cost, so drop whatever was typed.
                ...(next === 'OUT' ? { unitCost: '' } : {}),
              })
            }
          >
            <SelectTrigger
              size="sm"
              className="w-[92px]"
              aria-label={`Direction for line ${index + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="IN">IN</SelectItem>
                <SelectItem value="OUT">OUT</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        {readOnly ? (
          <span className="tabular-nums">{qty(quantity)}</span>
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.001"
            className="w-[110px] text-right tabular-nums"
            aria-label={`Quantity for line ${index + 1}`}
            value={line.quantity}
            onChange={(event) => onChange({ quantity: event.target.value })}
            onWheel={(event) => (event.target as HTMLInputElement).blur()}
          />
        )}
      </td>
      <td className="py-1.5 pr-2 text-right">
        {readOnly ? (
          <span className="tabular-nums">{money(cost)}</span>
        ) : line.direction === 'OUT' ? (
          <span
            className="text-muted-foreground text-xs"
            title="Stock leaves at the valuation it is held at, so the cost is not yours to set."
          >
            At valuation
          </span>
        ) : (
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            className="w-[110px] text-right tabular-nums"
            aria-label={`Unit cost for line ${index + 1}`}
            value={line.unitCost}
            onChange={(event) => onChange({ unitCost: event.target.value })}
            onWheel={(event) => (event.target as HTMLInputElement).blur()}
          />
        )}
      </td>
      <td className="py-1.5 pr-2 text-right tabular-nums">
        {lineValue === null ? <span className="text-muted-foreground">—</span> : money(lineValue)}
      </td>
      <td className="py-1.5 pr-2">
        {readOnly ? (
          <span className="text-muted-foreground">
            {line.reason === '' ? humanise(headerReason) : humanise(line.reason)}
          </span>
        ) : (
          <Select
            value={line.reason === '' ? '__header__' : line.reason}
            onValueChange={(next) => onChange({ reason: next === '__header__' ? '' : next })}
          >
            <SelectTrigger
              size="sm"
              className="w-[160px]"
              aria-label={`Reason for line ${index + 1}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__header__">Same as document</SelectItem>
                {Object.values(StockAdjustmentReason).map((value) => (
                  <SelectItem key={value} value={value}>
                    {humanise(value)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </td>
      <td className="py-1.5 pr-2">
        {readOnly ? (
          <span className="text-muted-foreground">{dash(line.notes)}</span>
        ) : (
          <Input
            className="w-[170px]"
            aria-label={`Notes for line ${index + 1}`}
            value={line.notes}
            maxLength={LIMITS.PURCHASE_LINE_NOTES_MAX}
            onChange={(event) => onChange({ notes: event.target.value })}
          />
        )}
      </td>
      {!readOnly && (
        <td className="py-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove line ${index + 1}`}
            className="hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2Icon />
          </Button>
        </td>
      )}
    </tr>
  );
}
