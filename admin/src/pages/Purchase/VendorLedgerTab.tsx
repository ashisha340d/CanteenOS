import { useMemo, useState } from 'react';
import {
  Capability,
  VendorLedgerTxnType,
  type VendorLedgerEntryDto,
  type VendorLedgerListQuery,
} from '@menuboard/shared';
import { LockIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/form/fields';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { ListToolbar } from '../../components/ListToolbar';
import { useVendorLedger } from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, humanise } from '@/lib/options';
import { dash, formatDateTime, money } from '../Stock/stockFormat';
import { VendorStatementDrawer } from './VendorStatementDrawer';
import { LoadError, NotPermitted, SupplierPicker } from './vendorAccountingShared';

/**
 * The vendor ledger. Every entry that ever touched a supplier's account, in sequence.
 *
 * Deliberately actionless and deliberately unsortable by date: two entries can share a
 * timestamp, and a running balance only means anything read in the order it was written. The
 * sequence is the only total order there is, so it is the only order offered.
 */
export function VendorLedgerTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.VENDOR_LEDGER_READ);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [transactionType, setTransactionType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [statementFor, setStatementFor] = useState<{ id: string; name: string } | null>(null);

  const query = useMemo<VendorLedgerListQuery>(() => {
    const built: VendorLedgerListQuery = { page, pageSize };
    if (supplierId !== '') built.supplierId = supplierId;
    if (transactionType !== '') built.transactionType = transactionType as VendorLedgerTxnType;
    if (dateFrom !== '') built.dateFrom = dateFrom;
    if (dateTo !== '') built.dateTo = dateTo;
    return built;
  }, [supplierId, transactionType, dateFrom, dateTo, page, pageSize]);

  const { data, isLoading, isError, refetch } = useVendorLedger(query, canRead);

  // Ordered again on arrival so the running balance always reads down the page in sequence,
  // whatever order the page came back in.
  const rows = useMemo(
    () => [...(data?.items ?? [])].sort((a, b) => b.entrySeq - a.entrySeq),
    [data?.items],
  );

  const filterCount =
    (supplierId ? 1 : 0) + (transactionType ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  function resetFilters(): void {
    setSupplierId('');
    setSupplierLabel('');
    setTransactionType('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const columns: DataTableColumn<VendorLedgerEntryDto>[] = [
    {
      field: 'entrySeq',
      headerName: 'Seq',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.entrySeq,
    },
    {
      field: 'occurredAt',
      headerName: 'Date',
      width: 170,
      valueGetter: (row) => formatDateTime(row.occurredAt),
    },
    {
      field: 'transactionType',
      headerName: 'Type',
      width: 170,
      renderCell: (row) => <Badge variant="outline">{humanise(row.transactionType)}</Badge>,
    },
    {
      field: 'documentNumber',
      headerName: 'Document no',
      width: 170,
      valueGetter: (row) => dash(row.documentNumber),
    },
    {
      field: 'reference',
      headerName: 'Reference',
      width: 150,
      valueGetter: (row) => dash(row.reference),
    },
    {
      field: 'narration',
      headerName: 'Narration',
      width: 300,
      valueGetter: (row) => dash(row.narration),
    },
    {
      field: 'debitAmount',
      headerName: 'Debit',
      width: 130,
      align: 'right',
      renderCell: (row) =>
        row.debitAmount > 0 ? (
          <span className="tabular-nums">{money(row.debitAmount)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'creditAmount',
      headerName: 'Credit',
      width: 130,
      align: 'right',
      renderCell: (row) =>
        row.creditAmount > 0 ? (
          <span className="tabular-nums">{money(row.creditAmount)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      field: 'runningBalance',
      headerName: 'Running balance',
      width: 150,
      align: 'right',
      renderCell: (row) => (
        <span className="font-semibold tabular-nums">{money(row.runningBalance)}</span>
      ),
    },
    {
      field: 'actorName',
      headerName: 'Actor',
      width: 150,
      valueGetter: (row) => dash(row.actorName),
    },
  ];

  if (!canRead) {
    return <NotPermitted what="The vendor ledger" capability="the vendor ledger read capability" />;
  }

  return (
    <>
      <p className="text-muted-foreground mb-3 flex items-start gap-1.5 text-xs">
        <LockIcon className="mt-[1px] size-3.5 shrink-0" aria-hidden />
        <span>
          Immutable history, newest first by entry sequence — never by date, because two entries
          can share a timestamp and the running balance only makes sense in sequence order.
          Entries are never edited or deleted; a mistake is corrected by posting its opposite.
          <strong className="text-foreground font-semibold">
            {' '}
            A credit increases what we owe the supplier, a debit reduces it.
          </strong>{' '}
          So an invoice is a credit and paying it is a debit.
        </span>
      </p>

      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SupplierPicker
              id="ledger-supplier"
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                setPage(1);
                // Picking a supplier is asking about their account, so the statement follows.
                setStatementFor(choice === null ? null : { id: choice.id, name: choice.label });
              }}
            />
            <SelectField
              label="Transaction type"
              value={transactionType}
              onChange={(next) => {
                setTransactionType(next);
                setPage(1);
              }}
              emptyLabel="Every type"
              options={enumOptions(VendorLedgerTxnType)}
            />
            <TextField
              label="From"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <TextField
              label="To"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </>
        }
        view="table"
        onViewChange={() => undefined}
        hideView
        page={page}
        pageSize={pageSize}
        total={data?.meta.total ?? 0}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        extraActions={
          <Button
            variant="outline"
            size="sm"
            disabled={supplierId === ''}
            onClick={() => setStatementFor({ id: supplierId, name: supplierLabel })}
          >
            {supplierId === '' ? 'Statement · pick a supplier' : 'Statement'}
          </Button>
        }
      />

      {isError ? (
        <LoadError what="The vendor ledger" onRetry={() => void refetch()} />
      ) : (
        /* No onSortChange anywhere: the sequence is the order, and offering a date sort would
           promise a precision the data does not have. */
        <DataTable
          gridId="vendor-ledger"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          emptyTitle="No ledger entries yet"
          emptyMessage="Entries appear here as purchases, payments, returns and memos post."
        />
      )}

      <VendorStatementDrawer
        supplierId={statementFor?.id ?? null}
        supplierName={statementFor?.name ?? ''}
        onClose={() => setStatementFor(null)}
      />
    </>
  );
}
