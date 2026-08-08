import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type ColumnOrderState,
  type ColumnPinningState,
  type ColumnSizingState,
  type RowSelectionState,
  type VisibilityState,
} from '@tanstack/react-table';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  GripVerticalIcon,
  PinIcon,
  PinOffIcon,
  RotateCcwIcon,
  Settings2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeletons';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { cn } from '@/lib/utils';
import { useGridState } from './gridState';

export interface DataTableColumn<T> {
  field: string;
  headerName: string;
  width?: number;
  minWidth?: number;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  renderCell?: (row: T) => ReactNode;
  valueGetter?: (row: T) => string | number | null | undefined;
  /** Keeps a column out of the visibility menu — used for the actions column. */
  alwaysVisible?: boolean;
}

export interface DataTableProps<T> {
  gridId: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  onSortChange?: (field: string, dir: 'asc' | 'desc') => void;
  onRowDoubleClick?: (row: T) => void;
  rowReorder?: boolean;
  onRowReorder?: (orderedIds: string[]) => void;
  selectable?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  /** Rendered in the table chrome while at least one row is selected. */
  bulkActions?: (selectedIds: string[]) => ReactNode;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** True when a search or filter is responsible for the empty result. */
  filtered?: boolean;
  /** Overrides the generated mobile card. */
  renderMobileCard?: (row: T) => ReactNode;
}

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 60;

/**
 * A column that declares neither `renderCell` nor `valueGetter` reads its value straight off
 * the row. Without this the cell rendered empty, which silently blanked every plain column
 * (names, usernames, every numeric report column) while the data was present all along.
 */
function cellContent<T>(column: DataTableColumn<T>, row: T): ReactNode {
  if (column.renderCell) return column.renderCell(row);
  const value = column.valueGetter
    ? column.valueGetter(row)
    : (row as Record<string, unknown>)[column.field];
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return value;
  return String(value);
}

const ALIGN_CLASS = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

/**
 * The portal's one data grid, built on TanStack Table.
 *
 * Sorting is deliberately *manual*: every listing page pages and sorts on the server, so the
 * table reports the intent through `onSortChange` and renders exactly the rows it is handed.
 * Letting TanStack sort locally would silently re-order only the current page and disagree
 * with the totals in the toolbar.
 *
 * On a narrow screen the whole table is abandoned rather than scaled down — a squeezed grid
 * is unreadable and untappable — and the same rows render as cards instead.
 */
export function DataTable<T>({
  gridId,
  columns,
  rows,
  getRowId,
  loading,
  sortBy,
  sortDir,
  onSortChange,
  onRowDoubleClick,
  rowReorder,
  onRowReorder,
  selectable,
  selected,
  onSelectedChange,
  bulkActions,
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyAction,
  filtered = false,
  renderMobileCard,
}: DataTableProps<T>): JSX.Element {
  const { isMobile, supportsPointerAffordances } = useDeviceProfile();
  const fields = useMemo(() => columns.map((column) => column.field), [columns]);
  const { state: persisted, update, reset } = useGridState(gridId, fields);
  const dragFieldRef = useRef<string | null>(null);
  const dragRowIdRef = useRef<string | null>(null);
  const [dragOverRowId, setDragOverRowId] = useState<string | null>(null);

  const columnDefs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.field,
        header: column.headerName,
        size: column.width ?? DEFAULT_WIDTH,
        minSize: column.minWidth ?? MIN_WIDTH,
        enableSorting: column.sortable !== false,
        enableHiding: column.alwaysVisible !== true,
        cell: ({ row }) => cellContent(column, row.original),
        meta: { align: column.align ?? 'left' },
      })),
    [columns],
  );

  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries((selected ?? []).map((id) => [id, true])),
    [selected],
  );

  const columnVisibility = useMemo<VisibilityState>(
    () => Object.fromEntries(persisted.hidden.map((field) => [field, false])),
    [persisted.hidden],
  );

  const columnPinning = useMemo<ColumnPinningState>(
    () => ({ left: persisted.pinned, right: [] }),
    [persisted.pinned],
  );

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    manualSorting: true,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    enableRowSelection: Boolean(selectable),
    state: {
      columnSizing: persisted.widths as ColumnSizingState,
      columnOrder: persisted.order as ColumnOrderState,
      columnVisibility,
      columnPinning,
      rowSelection,
    },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(persisted.widths) : updater;
      update({ widths: next });
    },
    onColumnOrderChange: (updater) => {
      const next = typeof updater === 'function' ? updater(persisted.order) : updater;
      update({ order: next });
    },
    onRowSelectionChange: (updater) => {
      if (!onSelectedChange) return;
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      onSelectedChange(Object.keys(next).filter((id) => next[id]));
    },
  });

  const handleSort = useCallback(
    (field: string) => {
      if (!onSortChange) return;
      const nextDir: 'asc' | 'desc' = sortBy === field && sortDir === 'asc' ? 'desc' : 'asc';
      update({ sortBy: field, sortDir: nextDir });
      onSortChange(field, nextDir);
    },
    [onSortChange, sortBy, sortDir, update],
  );

  const toggleVisibility = useCallback(
    (field: string, visible: boolean) => {
      update({
        hidden: visible ? persisted.hidden.filter((f) => f !== field) : [...persisted.hidden, field],
      });
    },
    [persisted.hidden, update],
  );

  const togglePinned = useCallback(
    (field: string) => {
      update({
        pinned: persisted.pinned.includes(field)
          ? persisted.pinned.filter((f) => f !== field)
          : [...persisted.pinned, field],
      });
    },
    [persisted.pinned, update],
  );

  /* --------------------------------------------------------------- column drag/drop */

  const onHeaderDragStart = (field: string) => (event: React.DragEvent) => {
    dragFieldRef.current = field;
    event.dataTransfer.effectAllowed = 'move';
  };
  const onHeaderDragOver = (event: React.DragEvent): void => event.preventDefault();
  const onHeaderDrop = (targetField: string) => (event: React.DragEvent) => {
    event.preventDefault();
    const source = dragFieldRef.current;
    dragFieldRef.current = null;
    if (!source || source === targetField) return;
    const order = [...persisted.order];
    const from = order.indexOf(source);
    const to = order.indexOf(targetField);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, source);
    update({ order });
  };

  /* ------------------------------------------------------------------ row drag/drop */

  const onRowDragStart = (id: string) => (event: React.DragEvent) => {
    dragRowIdRef.current = id;
    event.dataTransfer.effectAllowed = 'move';
  };
  const onRowDragOver = (id: string) => (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverRowId(id);
  };
  const onRowDrop = (targetId: string) => (event: React.DragEvent) => {
    event.preventDefault();
    setDragOverRowId(null);
    const sourceId = dragRowIdRef.current;
    dragRowIdRef.current = null;
    if (!sourceId || sourceId === targetId || !onRowReorder) return;
    const ids = rows.map(getRowId);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, sourceId);
    onRowReorder(ids);
  };

  /* ----------------------------------------------------------------------- states */

  // Loading and empty are page-level states, not a row inside the table. Rendering them as a
  // giant colspan cell was what made the grid look broken rather than busy.
  if (loading) {
    return <TableSkeleton columns={Math.min(fields.length || 5, 7)} />;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-card rounded-xl border">
        <EmptyState
          variant={filtered ? 'no-results' : 'empty'}
          title={filtered ? 'No matches' : emptyTitle}
          description={
            filtered
              ? 'Nothing matches the current search and filters. Try widening them.'
              : emptyMessage
          }
          {...(!filtered && emptyAction ? { action: emptyAction } : {})}
        />
      </div>
    );
  }

  const selectedIds = selected ?? [];

  /* ------------------------------------------------------------------ mobile cards */

  if (isMobile) {
    return (
      <MobileRows
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        onRowActivate={onRowDoubleClick}
        selectable={selectable}
        selectedIds={selectedIds}
        onSelectedChange={onSelectedChange}
        bulkActions={bulkActions}
        renderMobileCard={renderMobileCard}
      />
    );
  }

  /* ---------------------------------------------------------------- desktop table */

  const hideableColumns = columns.filter((column) => column.alwaysVisible !== true);

  return (
    <div className="bg-card overflow-hidden rounded-xl border">
      {/* Table chrome: bulk actions on the left as soon as something is selected, column
          controls on the right. Kept inside the table's own frame so it reads as belonging
          to the grid rather than to the page. */}
      <div className="flex min-h-11 items-center gap-2 border-b px-2 py-1.5">
        {selectedIds.length > 0 ? (
          <>
            <span className="text-muted-foreground px-1 text-sm tabular-nums">
              {selectedIds.length} selected
            </span>
            <div className="flex items-center gap-1.5">{bulkActions?.(selectedIds)}</div>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => onSelectedChange?.([])}
            >
              Clear
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground px-1 text-sm tabular-nums">
            {rows.length} {rows.length === 1 ? 'row' : 'rows'}
          </span>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn(selectedIds.length > 0 ? '' : 'ml-auto')}
              aria-label="Column settings"
            >
              <Settings2Icon data-icon="inline-start" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuGroup>
              {hideableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.field}
                  checked={!persisted.hidden.includes(column.field)}
                  onCheckedChange={(checked) => toggleVisibility(column.field, checked)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {column.headerName}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => reset()}>
                <RotateCcwIcon data-icon="inline-start" />
                Reset layout
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="max-h-[calc(100dvh-20rem)] overflow-auto">
        <Table style={{ width: table.getTotalSize(), tableLayout: 'fixed' }}>
          <TableHeader className="bg-card sticky top-0 z-20">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {rowReorder && <TableHead className="w-8" />}
                {selectable && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={
                        table.getIsAllRowsSelected()
                          ? true
                          : table.getIsSomeRowsSelected()
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(checked) =>
                        onSelectedChange?.(checked === true ? rows.map(getRowId) : [])
                      }
                      aria-label="Select all rows"
                    />
                  </TableHead>
                )}
                {headerGroup.headers.map((header) => {
                  const column = columns.find((entry) => entry.field === header.column.id);
                  const isSorted = sortBy === header.column.id;
                  const canSort = header.column.getCanSort();
                  const isPinned = header.column.getIsPinned() === 'left';
                  const align = column?.align ?? 'left';

                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      draggable={supportsPointerAffordances}
                      onDragStart={onHeaderDragStart(header.column.id)}
                      onDragOver={onHeaderDragOver}
                      onDrop={onHeaderDrop(header.column.id)}
                      aria-sort={isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn(
                        'group/head relative select-none',
                        ALIGN_CLASS[align],
                        isSorted && 'text-foreground',
                        isPinned && 'bg-card sticky z-10',
                      )}
                      style={{
                        width: header.getSize(),
                        ...(isPinned ? { left: header.column.getStart('left') } : {}),
                      }}
                    >
                      <div
                        className={cn(
                          'flex items-center gap-0.5 overflow-hidden',
                          align === 'right' && 'justify-end',
                          align === 'center' && 'justify-center',
                        )}
                      >
                        {supportsPointerAffordances && (
                          <GripVerticalIcon
                            aria-hidden
                            className="-ml-1.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/head:opacity-40"
                          />
                        )}
                        {canSort ? (
                          <button
                            type="button"
                            onClick={() => handleSort(header.column.id)}
                            className="hover:text-foreground focus-visible:ring-ring flex min-w-0 items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
                          >
                            <span className="truncate">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                            </span>
                            {isSorted ? (
                              sortDir === 'asc' ? (
                                <ArrowUpIcon className="text-primary size-3.5 shrink-0" />
                              ) : (
                                <ArrowDownIcon className="text-primary size-3.5 shrink-0" />
                              )
                            ) : (
                              <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover/head:opacity-40" />
                            )}
                          </button>
                        ) : (
                          <span className="truncate">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </span>
                        )}

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => togglePinned(header.column.id)}
                              aria-label={isPinned ? 'Unpin column' : 'Pin column to the left'}
                              className={cn(
                                'hover:text-foreground ml-auto shrink-0 rounded-sm p-0.5 transition-opacity',
                                isPinned ? 'text-primary opacity-100' : 'opacity-0 group-hover/head:opacity-50',
                              )}
                            >
                              {isPinned ? (
                                <PinOffIcon className="size-3.5" />
                              ) : (
                                <PinIcon className="size-3.5" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>{isPinned ? 'Unpin' : 'Pin left'}</TooltipContent>
                        </Tooltip>
                      </div>

                      {header.column.getCanResize() && (
                        <div
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onClick={(event) => event.stopPropagation()}
                          role="separator"
                          aria-orientation="vertical"
                          className={cn(
                            'hover:bg-primary absolute top-1.5 right-0 bottom-1.5 w-[5px] cursor-col-resize rounded-sm transition-colors',
                            header.column.getIsResizing() && 'bg-primary',
                          )}
                        />
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const id = row.id;
              return (
                <TableRow
                  key={id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onDoubleClick={() => onRowDoubleClick?.(row.original)}
                  draggable={rowReorder && supportsPointerAffordances}
                  onDragStart={rowReorder ? onRowDragStart(id) : undefined}
                  onDragOver={rowReorder ? onRowDragOver(id) : undefined}
                  onDrop={rowReorder ? onRowDrop(id) : undefined}
                  className={cn(
                    'group/row',
                    onRowDoubleClick && 'cursor-pointer',
                    // A drop target should be unmistakable, so it gets a line, not a tint.
                    dragOverRowId === id && 'shadow-[inset_0_2px_0_var(--primary)]',
                  )}
                >
                  {rowReorder && (
                    <TableCell className="w-8 cursor-grab">
                      <GripVerticalIcon
                        aria-hidden
                        className="size-4 opacity-0 transition-opacity group-hover/row:opacity-50"
                      />
                    </TableCell>
                  )}
                  {selectable && (
                    <TableCell className="w-10">
                      <Checkbox
                        checked={row.getIsSelected()}
                        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
                        aria-label="Select row"
                      />
                    </TableCell>
                  )}
                  {row.getVisibleCells().map((cell, cellIndex) => {
                    const column = columns.find((entry) => entry.field === cell.column.id);
                    const isPinned = cell.column.getIsPinned() === 'left';
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'truncate',
                          ALIGN_CLASS[column?.align ?? 'left'],
                          // The first column is the row's identity; it carries the weight.
                          cellIndex === 0 ? 'text-foreground font-medium' : 'text-muted-foreground',
                          isPinned && 'bg-card sticky z-10',
                        )}
                        style={{
                          width: cell.column.getSize(),
                          ...(isPinned ? { left: cell.column.getStart('left') } : {}),
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ mobile view */

interface MobileRowsProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  onRowActivate?: (row: T) => void;
  selectable?: boolean;
  selectedIds: string[];
  onSelectedChange?: (ids: string[]) => void;
  bulkActions?: (selectedIds: string[]) => ReactNode;
  renderMobileCard?: (row: T) => ReactNode;
}

/**
 * The same rows as list cards. The first column becomes the card's title and the rest become
 * label/value pairs, so a page gets a usable mobile view without having to hand-write one —
 * but `renderMobileCard` is there for the pages that deserve better than the generic shape.
 */
function MobileRows<T>({
  columns,
  rows,
  getRowId,
  onRowActivate,
  selectable,
  selectedIds,
  onSelectedChange,
  bulkActions,
  renderMobileCard,
}: MobileRowsProps<T>): JSX.Element {
  const [primary, ...rest] = columns;
  const detailColumns = rest.filter((column) => column.field !== 'actions');
  const actionsColumn = columns.find((column) => column.field === 'actions');

  return (
    <div className="flex flex-col gap-2">
      {selectable && selectedIds.length > 0 && (
        <div className="bg-card sticky top-0 z-10 flex items-center gap-2 rounded-lg border p-2">
          <span className="text-sm tabular-nums">{selectedIds.length} selected</span>
          <div className="ml-auto flex items-center gap-1.5">
            {bulkActions?.(selectedIds)}
            <Button variant="ghost" size="sm" onClick={() => onSelectedChange?.([])}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {rows.map((row) => {
        const id = getRowId(row);
        const isSelected = selectedIds.includes(id);

        if (renderMobileCard) {
          return (
            <div
              key={id}
              onClick={() => onRowActivate?.(row)}
              className={cn(
                'bg-card rounded-xl border p-3',
                onRowActivate && 'active:bg-accent cursor-pointer',
              )}
            >
              {renderMobileCard(row)}
            </div>
          );
        }

        return (
          <div
            key={id}
            className={cn(
              'bg-card rounded-xl border p-3',
              isSelected && 'border-primary bg-sidebar-accent',
            )}
          >
            <div className="flex items-start gap-3">
              {selectable && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) =>
                    onSelectedChange?.(
                      checked === true
                        ? [...selectedIds, id]
                        : selectedIds.filter((entry) => entry !== id),
                    )
                  }
                  aria-label="Select row"
                  className="mt-1"
                />
              )}
              <button
                type="button"
                onClick={() => onRowActivate?.(row)}
                disabled={!onRowActivate}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                {primary && (
                  <p className="truncate font-semibold">{cellContent(primary, row)}</p>
                )}
                <dl className="mt-2 grid grid-cols-[minmax(5rem,auto)_1fr] gap-x-3 gap-y-1">
                  {detailColumns.map((column) => (
                    <div key={column.field} className="contents">
                      <dt className="text-muted-foreground truncate text-xs">
                        {column.headerName}
                      </dt>
                      <dd className="min-w-0 truncate text-sm">{cellContent(column, row)}</dd>
                    </div>
                  ))}
                </dl>
              </button>
            </div>
            {actionsColumn && (
              <div className="mt-2 flex justify-end gap-1 border-t pt-2">
                {cellContent(actionsColumn, row)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
