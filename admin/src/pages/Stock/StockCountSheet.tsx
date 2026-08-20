import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LIMITS,
  StockAdjustmentReason,
  StockCountStatus,
  type RecordStockCountLinesRequest,
  type StockCountDto,
} from '@menuboard/shared';
import { CheckCheckIcon, SaveIcon, SendIcon } from 'lucide-react';
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
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Modal } from '../../components/Modal/Modal';
import { StatusChip } from '../../components/StatusChip';
import {
  useApproveStockCount,
  useCancelStockCount,
  useRecordStockCountLines,
  useStockCount,
  useSubmitStockCount,
} from '../../hooks/useStock';
import { humanise } from '@/lib/options';
import { notify } from '@/lib/notify';
import { dash, formatDate, money, qty, signed, varianceClass } from './stockFormat';

const HEADER_REASON = '__none__';

const RECORDING_STATUSES: StockCountStatus[] = [
  StockCountStatus.DRAFT,
  StockCountStatus.COUNTING,
];
const OPEN_STATUSES: StockCountStatus[] = [
  StockCountStatus.DRAFT,
  StockCountStatus.COUNTING,
  StockCountStatus.SUBMITTED,
];

interface LineEdit {
  physical: string;
  reason: string;
  notes: string;
}

type ConfirmKind = 'submit' | 'approve' | 'cancel';

/**
 * The count sheet: where somebody standing in the store types what is actually on the shelf.
 *
 * Built for a keyboard and one hand — Enter and the arrow keys walk straight down the physical
 * quantity column, focus selects whatever was there so a retype replaces it, and the variance
 * against the snapshot updates as each figure lands.
 */
export function StockCountSheet({
  open,
  countId,
  canRecord,
  canApprove,
  onClose,
  onOpenAdjustment,
}: {
  open: boolean;
  countId: string;
  canRecord: boolean;
  canApprove: boolean;
  onClose: () => void;
  onOpenAdjustment: (adjustmentId: string) => void;
}): JSX.Element {
  const { data: count, isLoading, isError, refetch } = useStockCount(countId);
  const record = useRecordStockCountLines();
  const submit = useSubmitStockCount();
  const approve = useApproveStockCount();
  const cancel = useCancelStockCount();

  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [approvedAdjustment, setApprovedAdjustment] = useState<{
    id: string;
    number: string;
  } | null>(null);
  const hydratedRef = useRef('');
  const gridRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => count?.lines ?? [], [count?.lines]);

  useEffect(() => {
    if (!open || !count) return;
    const token = `${count.id}:${count.revision}`;
    if (hydratedRef.current === token) return;
    hydratedRef.current = token;
    const next: Record<string, LineEdit> = {};
    for (const line of count.lines ?? []) {
      next[line.id] = {
        physical: line.physicalQuantity === null ? '' : String(line.physicalQuantity),
        reason: line.reason ?? '',
        notes: line.notes ?? '',
      };
    }
    setEdits(next);
  }, [open, count]);

  const editable = canRecord && count !== undefined && RECORDING_STATUSES.includes(count.status);
  const working = record.isPending || submit.isPending || approve.isPending || cancel.isPending;

  const countedNow = lines.filter((line) => (edits[line.id]?.physical ?? '') !== '').length;

  const dirtyLines = lines.filter((line) => {
    const edit = edits[line.id];
    if (edit === undefined) return false;
    const original = line.physicalQuantity === null ? '' : String(line.physicalQuantity);
    return (
      edit.physical !== original ||
      edit.reason !== (line.reason ?? '') ||
      edit.notes !== (line.notes ?? '')
    );
  });

  const liveVarianceValue = lines.reduce((total, line) => {
    const physical = edits[line.id]?.physical ?? '';
    if (physical === '') return total;
    return total + (Number(physical) - line.systemQuantity) * line.unitCost;
  }, 0);

  function patchEdit(lineId: string, patch: Partial<LineEdit>): void {
    setEdits((current) => ({
      ...current,
      [lineId]: {
        physical: current[lineId]?.physical ?? '',
        reason: current[lineId]?.reason ?? '',
        notes: current[lineId]?.notes ?? '',
        ...patch,
      },
    }));
  }

  /** The inputs are keyed by row in the DOM, because a plain Input takes no ref. */
  function focusRow(index: number): void {
    gridRef.current
      ?.querySelector<HTMLInputElement>(`[data-count-row="${index}"]`)
      ?.focus();
  }

  async function save(): Promise<void> {
    if (!count || dirtyLines.length === 0) return;
    const body: RecordStockCountLinesRequest = {
      lines: dirtyLines.map((line) => {
        const physical = edits[line.id]?.physical ?? '';
        const reason = edits[line.id]?.reason ?? '';
        const notes = edits[line.id]?.notes ?? '';
        return {
          lineId: line.id,
          physicalQuantity: physical === '' ? null : Number(physical),
          reason: (reason === '' ? null : reason) as StockAdjustmentReason | null,
          notes: notes === '' ? null : notes,
        };
      }),
      expectedRevision: count.revision,
    };
    try {
      await record.mutateAsync({ id: count.id, body });
      notify.success(
        `${dirtyLines.length} ${dirtyLines.length === 1 ? 'line' : 'lines'} recorded.`,
      );
    } catch (err) {
      notify.fromError(err);
    }
  }

  async function runConfirmed(): Promise<void> {
    if (!count || confirm === null) return;
    try {
      if (confirm === 'submit') {
        await submit.mutateAsync(count.id);
        notify.success(`${count.countNumber} submitted for approval.`);
      } else if (confirm === 'approve') {
        const result = await approve.mutateAsync(count.id);
        if (result.adjustment === null) {
          notify.success('Approved. Every line matched, so nothing needed adjusting.');
        } else {
          setApprovedAdjustment({
            id: result.adjustment.id,
            number: result.adjustment.adjustmentNumber,
          });
          notify.success(
            `Approved. Variance posted as adjustment ${result.adjustment.adjustmentNumber}.`,
          );
        }
      } else {
        await cancel.mutateAsync({ id: count.id });
        notify.success(`${count.countNumber} cancelled.`);
      }
      setConfirm(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const confirmCopy = (): { title: string; message: string; label: string; danger: boolean } => {
    if (count === undefined || confirm === null) {
      return { title: '', message: '', label: 'Confirm', danger: false };
    }
    if (confirm === 'submit') {
      return {
        title: 'Submit count',
        message: `Submit ${count.countNumber} with ${countedNow} of ${lines.length} lines counted? Uncounted lines are left as they are and the sheet can no longer be typed into.`,
        label: 'Submit',
        danger: false,
      };
    }
    if (confirm === 'approve') {
      return {
        title: 'Approve count',
        message: `Approve ${count.countNumber}? Every variance on the sheet is turned into a posted stock adjustment worth ${money(count.totalVarianceValue ?? liveVarianceValue)} and the balances are rewritten to the physical figures. This cannot be undone.`,
        label: 'Approve and post',
        danger: true,
      };
    }
    return {
      title: 'Cancel count',
      message: `Cancel ${count.countNumber}? Nothing is adjusted and the sheet is closed as CANCELLED.`,
      label: 'Cancel count',
      danger: true,
    };
  };

  const copy = confirmCopy();
  const firstUncounted = lines.findIndex((line) => (edits[line.id]?.physical ?? '') === '');

  return (
    <Modal
      id="stock-count-sheet"
      title={count ? `Count sheet ${count.countNumber}` : 'Count sheet'}
      open={open}
      onClose={onClose}
      minWidth={1020}
      minHeight={560}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={working}>
            Close
          </Button>
          {canRecord && count !== undefined && OPEN_STATUSES.includes(count.status) && (
            <Button
              type="button"
              variant="outline"
              className="hover:text-destructive"
              onClick={() => setConfirm('cancel')}
              disabled={working}
            >
              Cancel count
            </Button>
          )}
          {editable && (
            <Button type="button" onClick={() => void save()} disabled={working || dirtyLines.length === 0}>
              <SaveIcon data-icon="inline-start" />
              {dirtyLines.length === 0
                ? 'Saved'
                : `Save ${dirtyLines.length} ${dirtyLines.length === 1 ? 'line' : 'lines'}`}
            </Button>
          )}
          {editable && (
            <Button
              type="button"
              onClick={() => setConfirm('submit')}
              disabled={working || countedNow === 0}
            >
              <SendIcon data-icon="inline-start" />
              Submit
            </Button>
          )}
          {canApprove && count?.status === StockCountStatus.SUBMITTED && (
            <Button type="button" onClick={() => setConfirm('approve')} disabled={working}>
              <CheckCheckIcon data-icon="inline-start" />
              Approve
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 8 }, (_unused, index) => (
            <Skeleton key={index} className="h-8 rounded-md" />
          ))}
        </div>
      ) : isError || count === undefined ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm font-medium">This count sheet could not be loaded.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <CountStrip count={count} countedNow={countedNow} liveVarianceValue={liveVarianceValue} />

          {approvedAdjustment !== null && (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>
                  The variance was posted as adjustment {approvedAdjustment.number}.
                </span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => onOpenAdjustment(approvedAdjustment.id)}
                >
                  Open it
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {!editable && (
            <p className="text-muted-foreground text-xs">
              {count.status === StockCountStatus.SUBMITTED
                ? 'Submitted and awaiting approval — the physical figures are fixed.'
                : canRecord
                  ? 'This sheet is closed. Nothing further can be typed into it.'
                  : 'Recording physical quantities is not permitted for your role.'}
            </p>
          )}

          {lines.length === 0 ? (
            <p className="text-muted-foreground py-6 text-sm">
              This count has no lines. Nothing was holding stock at the location when it was
              raised.
            </p>
          ) : (
            <div ref={gridRef} className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-xs">
                    <th className="pb-2 text-left font-normal">#</th>
                    <th className="pb-2 text-left font-normal">Product</th>
                    <th className="pb-2 text-left font-normal">Batch</th>
                    <th className="pb-2 text-left font-normal">Unit</th>
                    <th className="pb-2 text-right font-normal">System</th>
                    <th className="pb-2 text-right font-normal">Physical</th>
                    <th className="pb-2 text-right font-normal">Variance</th>
                    <th className="pb-2 text-right font-normal">Value</th>
                    <th className="pb-2 text-left font-normal">Reason</th>
                    <th className="pb-2 text-left font-normal">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, index) => {
                    const edit = edits[line.id];
                    const physical = edit?.physical ?? '';
                    const variance =
                      physical === '' ? null : Number(physical) - line.systemQuantity;
                    const varianceValue = variance === null ? null : variance * line.unitCost;
                    return (
                      <tr key={line.id} className="border-b last:border-b-0">
                        <td className="text-muted-foreground py-1 pr-2 tabular-nums">
                          {index + 1}
                        </td>
                        <td className="py-1 pr-2">
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{dash(line.productName)}</span>
                            {line.productCode ? (
                              <span className="text-muted-foreground text-xs">
                                {line.productCode}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="text-muted-foreground py-1 pr-2">
                          {dash(line.batchNumber)}
                        </td>
                        <td className="text-muted-foreground py-1 pr-2">
                          {dash(line.productUnit)}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">
                          {qty(line.systemQuantity)}
                        </td>
                        <td className="py-1 pr-2 text-right">
                          {editable ? (
                            <Input
                              data-count-row={index}
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="0.001"
                              autoFocus={index === Math.max(0, firstUncounted)}
                              className="w-[110px] text-right tabular-nums"
                              aria-label={`Physical quantity for ${line.productName ?? 'line'} ${index + 1}`}
                              value={physical}
                              onChange={(event) =>
                                patchEdit(line.id, { physical: event.target.value })
                              }
                              onWheel={(event) => (event.target as HTMLInputElement).blur()}
                              onKeyDown={(event) => {
                                // Down the column, not across the row: the counter is reading
                                // a shelf, not filling in a form.
                                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                                  event.preventDefault();
                                  focusRow(index + 1);
                                } else if (event.key === 'ArrowUp') {
                                  event.preventDefault();
                                  focusRow(index - 1);
                                }
                              }}
                            />
                          ) : (
                            <span className="tabular-nums">
                              {line.physicalQuantity === null ? '—' : qty(line.physicalQuantity)}
                            </span>
                          )}
                        </td>
                        <td
                          className={`py-1 pr-2 text-right font-semibold tabular-nums ${varianceClass(variance)}`}
                        >
                          {variance === null ? '—' : signed(variance)}
                        </td>
                        <td
                          className={`py-1 pr-2 text-right tabular-nums ${varianceClass(varianceValue)}`}
                        >
                          {varianceValue === null ? '—' : money(varianceValue)}
                        </td>
                        <td className="py-1 pr-2">
                          {editable ? (
                            <Select
                              value={
                                edit === undefined || edit.reason === '' ? HEADER_REASON : edit.reason
                              }
                              onValueChange={(next) =>
                                patchEdit(line.id, {
                                  reason: next === HEADER_REASON ? '' : next,
                                })
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-[150px]"
                                aria-label={`Variance reason for line ${index + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value={HEADER_REASON}>Count variance</SelectItem>
                                  {Object.values(StockAdjustmentReason).map((value) => (
                                    <SelectItem key={value} value={value}>
                                      {humanise(value)}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-muted-foreground">
                              {line.reason === null ? '—' : humanise(line.reason)}
                            </span>
                          )}
                        </td>
                        <td className="py-1">
                          {editable ? (
                            <Input
                              className="w-[160px]"
                              aria-label={`Notes for line ${index + 1}`}
                              maxLength={LIMITS.PURCHASE_LINE_NOTES_MAX}
                              value={edit?.notes ?? ''}
                              onChange={(event) =>
                                patchEdit(line.id, { notes: event.target.value })
                              }
                            />
                          ) : (
                            <span className="text-muted-foreground">{dash(line.notes)}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={copy.title}
        message={copy.message}
        confirmLabel={copy.label}
        danger={copy.danger}
        loading={working}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  );
}

/** The sheet's own header: where it is, how far through it is, and what it is worth so far. */
function CountStrip({
  count,
  countedNow,
  liveVarianceValue,
}: {
  count: StockCountDto;
  countedNow: number;
  liveVarianceValue: number;
}): JSX.Element {
  const total = count.lineCount ?? count.lines?.length ?? 0;
  const pct = total === 0 ? 0 : Math.round((countedNow / total) * 100);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-3 py-2 text-xs">
      <StatusChip status={count.status} />
      <span className="text-muted-foreground">
        {dash(count.locationName)} · {formatDate(count.businessDate)}
      </span>
      <Badge variant="outline">{count.isFullCount ? 'Full count' : 'Partial'}</Badge>
      <span className="flex items-center gap-2">
        <span className="bg-muted h-1.5 w-24 overflow-hidden rounded-full">
          <span
            className={countedNow >= total && total > 0 ? 'bg-tone-success-solid block h-full' : 'bg-tone-info-solid block h-full'}
            style={{ width: `${pct}%` }}
          />
        </span>
        <span className="text-muted-foreground tabular-nums">
          {countedNow}/{total} counted
        </span>
      </span>
      <span className={`tabular-nums ${varianceClass(liveVarianceValue)}`}>
        Variance {money(liveVarianceValue)}
      </span>
      {count.adjustmentNumber ? (
        <Badge variant="secondary">Adjustment {count.adjustmentNumber}</Badge>
      ) : null}
    </div>
  );
}
