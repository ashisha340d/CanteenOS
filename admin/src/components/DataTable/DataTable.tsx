import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AgGridReact } from 'ag-grid-react';
import type {
  ColDef,
  ColumnMovedEvent,
  ColumnResizedEvent,
  GetRowIdParams,
  GridReadyEvent,
  ICellRendererParams,
  RowDragEndEvent,
  SelectionChangedEvent,
  SortChangedEvent,
} from 'ag-grid-community';
import {
  PinIcon,
  PinOffIcon,
  RotateCcwIcon,
  Settings2Icon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeletons';
import { cn } from '@/lib/utils';
import { useGridState } from './gridState';
// AG Grid ships its layout and theme as plain CSS, not CSS-in-JS — without these the grid has
// no structural styling at all and every cell just stacks as block-level HTML.
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import './agGridTheme.css';

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
}

const DEFAULT_WIDTH = 160;
const MIN_WIDTH = 60;
const SELECT_COL = '__select';

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
  left: '',
  right: 'text-right justify-end',
  center: 'text-center justify-center',
} as const;

/**
 * The portal's one data grid, built on AG Grid Community.
 *
 * Sorting is deliberately *manual*: every listing page pages and sorts on the server, so a
 * sortable column carries a no-op comparator — AG Grid still shows the arrow and fires
 * `onSortChange`, but never reorders the page it was handed. Letting it sort locally would
 * silently re-order only the current page and disagree with the totals in the toolbar.
 *
 * On a narrow screen the grid is abandoned rather than scaled down — a squeezed grid is
 * unreadable and untappable — and the same rows render as cards instead.
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
}: DataTableProps<T>): JSX.Element {
  const fields = useMemo(() => columns.map((column) => column.field), [columns]);
  const { state: persisted, update, reset } = useGridState(gridId, fields);
  const gridApiRef = useRef<GridReadyEvent['api'] | null>(null);
  const selectedIds = useMemo(() => selected ?? [], [selected]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const getRowIdFn = useCallback(
    (params: GetRowIdParams<T>) => getRowId(params.data),
    [getRowId],
  );

  const columnDefs = useMemo<ColDef<T>[]>(() => {
    const defs: ColDef<T>[] = [];
    if (selectable) {
      defs.push({
        colId: SELECT_COL,
        headerCheckboxSelection: true,
        checkboxSelection: true,
        width: 40,
        minWidth: 40,
        maxWidth: 40,
        pinned: 'left',
        lockPosition: true,
        suppressMovable: true,
        sortable: false,
        resizable: false,
        rowDrag: false,
        headerName: '',
      });
    }
    const ordered = [...columns].sort((a, b) => {
      const orderA = persisted.order.indexOf(a.field);
      const orderB = persisted.order.indexOf(b.field);
      return (orderA === -1 ? Infinity : orderA) - (orderB === -1 ? Infinity : orderB);
    });

    ordered.forEach((column, index) => {
      const isFirst = index === 0;
      defs.push({
        colId: column.field,
        field: column.field as never,
        headerName: column.headerName,
        width: persisted.widths[column.field] ?? column.width ?? DEFAULT_WIDTH,
        minWidth: column.minWidth ?? MIN_WIDTH,
        sortable: column.sortable !== false && Boolean(onSortChange),
        sortingOrder: ['asc', 'desc'],
        comparator: () => 0, // manual sort — never let AG Grid re-order the page itself
        sort: sortBy === column.field ? sortDir ?? null : null,
        hide: persisted.hidden.includes(column.field),
        pinned: persisted.pinned.includes(column.field) ? 'left' : undefined,
        rowDrag: rowReorder && isFirst && !selectable,
        suppressHeaderMenuButton: true,
        headerClass: column.align ? ALIGN_CLASS[column.align] : undefined,
        cellClass: cn(
          'truncate',
          column.align ? ALIGN_CLASS[column.align] : undefined,
          index === 0 ? 'font-medium text-foreground' : 'text-muted-foreground',
        ),
        cellRenderer: (params: ICellRendererParams<T>) =>
          params.data === undefined ? null : cellContent(column, params.data),
      });
    });
    return defs;
  }, [
    columns,
    onSortChange,
    persisted.hidden,
    persisted.order,
    persisted.pinned,
    persisted.widths,
    rowReorder,
    selectable,
    sortBy,
    sortDir,
  ]);

  const handleSortChanged = useCallback(
    (event: SortChangedEvent<T>) => {
      if (!onSortChange || event.source === 'api') return;
      const sorted = event.api
        .getColumnState()
        .find((state) => state.sort != null && state.colId !== SELECT_COL);
      const dir = sorted?.sort;
      if (!sorted || dir !== 'asc' && dir !== 'desc') return;
      update({ sortBy: sorted.colId, sortDir: dir });
      onSortChange(sorted.colId, dir);
    },
    [onSortChange, update],
  );

  const handleColumnResized = useCallback(
    (event: ColumnResizedEvent<T>) => {
      if (!event.finished || event.source === 'api') return;
      const widths = { ...persisted.widths };
      for (const column of event.columns ?? []) {
        if (column.getColId() === SELECT_COL) continue;
        widths[column.getColId()] = column.getActualWidth();
      }
      update({ widths });
    },
    [persisted.widths, update],
  );

  const handleColumnMoved = useCallback(
    (event: ColumnMovedEvent<T>) => {
      if (event.source === 'api') return;
      const order = event.api
        .getColumnState()
        .map((state) => state.colId)
        .filter((id) => id !== SELECT_COL);
      update({ order });
    },
    [update],
  );

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<T>) => {
      if (!onSelectedChange) return;
      onSelectedChange(event.api.getSelectedRows().map(getRowId));
    },
    [getRowId, onSelectedChange],
  );

  const handleRowDragEnd = useCallback(
    (event: RowDragEndEvent<T>) => {
      if (!onRowReorder) return;
      const ids: string[] = [];
      event.api.forEachNode((node) => {
        if (node.data) ids.push(getRowId(node.data));
      });
      onRowReorder(ids);
    },
    [getRowId, onRowReorder],
  );

  const handleGridReady = useCallback((event: GridReadyEvent<T>) => {
    gridApiRef.current = event.api;
  }, []);

  // The grid owns its own selection model; this keeps it obedient to a controlled `selected`
  // prop (e.g. a "clear" button elsewhere in the page) without fighting the user's own clicks.
  useEffect(() => {
    const api = gridApiRef.current;
    if (!api || !selectable) return;
    api.forEachNode((node) => {
      const shouldBeSelected = node.data !== undefined && selectedSet.has(getRowId(node.data));
      if (node.isSelected() !== shouldBeSelected) node.setSelected(shouldBeSelected, false, 'api');
    });
  }, [selectedSet, selectable, getRowId, rows]);

  const handleRowDoubleClicked = useCallback(
    (event: { data?: T }) => {
      if (event.data) onRowDoubleClick?.(event.data);
    },
    [onRowDoubleClick],
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

  // Loading and empty are page-level states, not a row inside the grid. Rendering them as a
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

  const hideableColumns = columns.filter((column) => column.alwaysVisible !== true);

  return (
    <div className="bg-card flex h-full min-h-0 flex-col overflow-hidden rounded-xl border">
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
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuGroup>
              {hideableColumns.map((column) => {
                const isPinned = persisted.pinned.includes(column.field);
                return (
                  <DropdownMenuCheckboxItem
                    key={column.field}
                    checked={!persisted.hidden.includes(column.field)}
                    onCheckedChange={(checked) => toggleVisibility(column.field, checked)}
                    onSelect={(event) => event.preventDefault()}
                    className="pr-1"
                  >
                    <span className="min-w-0 flex-1 truncate">{column.headerName}</span>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePinned(column.field);
                      }}
                      aria-label={isPinned ? 'Unpin column' : 'Pin column to the left'}
                      className={cn(
                        'focus-ring ml-2 shrink-0 rounded-sm p-0.5',
                        isPinned ? 'text-primary' : 'text-muted-foreground/60 hover:text-foreground',
                      )}
                    >
                      {isPinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
                    </button>
                  </DropdownMenuCheckboxItem>
                );
              })}
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

      <div className="ag-theme-quartz w-full">
        <AgGridReact<T>
          rowData={rows}
          columnDefs={columnDefs}
          getRowId={getRowIdFn}
          domLayout="autoHeight"
          suppressCellFocus
          suppressMovableColumns={false}
          rowSelection={selectable ? 'multiple' : undefined}
          suppressRowClickSelection
          rowDragManaged={Boolean(rowReorder)}
          animateRows={Boolean(rowReorder)}
          onGridReady={handleGridReady}
          onSortChanged={handleSortChanged}
          onColumnResized={handleColumnResized}
          onColumnMoved={handleColumnMoved}
          onSelectionChanged={selectable ? handleSelectionChanged : undefined}
          onRowDragEnd={rowReorder ? handleRowDragEnd : undefined}
          onRowDoubleClicked={onRowDoubleClick ? handleRowDoubleClicked : undefined}
        />
      </div>
    </div>
  );
}


