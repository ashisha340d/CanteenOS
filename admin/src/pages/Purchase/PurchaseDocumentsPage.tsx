import { useMemo, useState } from 'react';
import {
  Capability,
  GoodsReceiptStatus,
  MasterStatus,
  MatchStatus,
  PayableStatus,
  PurchaseInvoiceStatus,
  type GoodsReceiptDto,
  type GoodsReceiptListQuery,
  type PurchaseInvoiceDto,
  type PurchaseInvoiceListQuery,
} from '@menuboard/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { CheckboxField, SelectField, TextField } from '@/components/form/fields';
import { ModulePage } from '@/components/ModulePage';
import { DataTable, type DataTableColumn } from '../../components/DataTable/DataTable';
import { ListToolbar } from '../../components/ListToolbar';
import { StatusChip } from '../../components/StatusChip';
import { useInventoryLocations } from '../../hooks/usePurchase';
import { usePurchaseDocumentFlow } from '../../hooks/usePurchaseEntry';
import {
  useGoodsReceipt,
  useGoodsReceipts,
  usePurchaseInvoice,
  usePurchaseInvoices,
} from '../../hooks/useVendorAccounting';
import { useAuth } from '../../services/AuthContext';
import { enumOptions, humanise, toOptions } from '@/lib/options';
import { dash, formatDate, money, qty } from '../Stock/stockFormat';
import { DocumentFlowPanel } from './DocumentFlowPanel';
import { LoadError, NotPermitted, SupplierPicker } from './vendorAccountingShared';

/**
 * The two documents a posted purchase leaves behind: the supplier's invoice as we recorded it,
 * and the goods receipt that put the stock away. Both are read-only by construction — there is
 * no way for either to come into being other than a post.
 */
export function PurchaseDocumentsPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="purchase-documents"
      eyebrow="Purchase"
      title="Purchase Documents"
      subtitle="Purchase invoices and goods receipts as posted, with their lines, their destination splits and the document chain each one belongs to."
      defaultTab="invoices"
      tabs={[
        { key: 'invoices', label: 'Invoices', content: <InvoicesTab /> },
        { key: 'receipts', label: 'Goods Receipts', content: <ReceiptsTab /> },
      ]}
    />
  );
}

/* ------------------------------------------------------------------------- invoices */

function InvoicesTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.PURCHASE_READ);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [status, setStatus] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [matchStatus, setMatchStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useMemo<PurchaseInvoiceListQuery>(() => {
    const built: PurchaseInvoiceListQuery = { page, pageSize };
    if (supplierId !== '') built.supplierId = supplierId;
    if (status !== '') built.status = status as PurchaseInvoiceStatus;
    if (paymentStatus !== '') built.paymentStatus = paymentStatus as PayableStatus;
    if (matchStatus !== '') built.matchStatus = matchStatus as MatchStatus;
    if (dateFrom !== '') built.dateFrom = dateFrom;
    if (dateTo !== '') built.dateTo = dateTo;
    if (overdueOnly) built.overdueOnly = true;
    return built;
  }, [supplierId, status, paymentStatus, matchStatus, dateFrom, dateTo, overdueOnly, page, pageSize]);

  const { data, isLoading, isError, refetch } = usePurchaseInvoices(query, canRead);
  const rows = data?.items ?? [];

  const filterCount =
    (supplierId ? 1 : 0) +
    (status ? 1 : 0) +
    (paymentStatus ? 1 : 0) +
    (matchStatus ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (overdueOnly ? 1 : 0);

  function resetFilters(): void {
    setSupplierId('');
    setSupplierLabel('');
    setStatus('');
    setPaymentStatus('');
    setMatchStatus('');
    setDateFrom('');
    setDateTo('');
    setOverdueOnly(false);
    setPage(1);
  }

  const columns: DataTableColumn<PurchaseInvoiceDto>[] = [
    { field: 'invoiceNumber', headerName: 'Our no', width: 170 },
    {
      field: 'supplierInvoiceNumber',
      headerName: 'Their bill no',
      width: 150,
      valueGetter: (row) => dash(row.supplierInvoiceNumber),
    },
    {
      field: 'supplierName',
      headerName: 'Supplier',
      width: 190,
      valueGetter: (row) => dash(row.supplierName),
    },
    {
      field: 'supplierInvoiceDate',
      headerName: 'Invoice date',
      width: 130,
      valueGetter: (row) => formatDate(row.supplierInvoiceDate),
    },
    {
      field: 'dueDate',
      headerName: 'Due date',
      width: 130,
      valueGetter: (row) => formatDate(row.dueDate),
    },
    {
      field: 'taxableAmount',
      headerName: 'Taxable',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.taxableAmount),
    },
    {
      field: 'cgstAmount',
      headerName: 'CGST',
      width: 110,
      align: 'right',
      valueGetter: (row) => money(row.cgstAmount),
    },
    {
      field: 'sgstAmount',
      headerName: 'SGST',
      width: 110,
      align: 'right',
      valueGetter: (row) => money(row.sgstAmount),
    },
    {
      field: 'igstAmount',
      headerName: 'IGST',
      width: 110,
      align: 'right',
      valueGetter: (row) => money(row.igstAmount),
    },
    {
      field: 'totalAmount',
      headerName: 'Total',
      width: 130,
      align: 'right',
      renderCell: (row) => (
        <span className="font-semibold tabular-nums">{money(row.totalAmount)}</span>
      ),
    },
    {
      field: 'paidAmount',
      headerName: 'Paid',
      width: 120,
      align: 'right',
      valueGetter: (row) => money(row.paidAmount),
    },
    {
      field: 'outstandingAmount',
      headerName: 'Outstanding',
      width: 130,
      align: 'right',
      valueGetter: (row) => money(row.outstandingAmount),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 140,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
    {
      field: 'matchStatus',
      headerName: 'Match',
      width: 170,
      renderCell: (row) => <Badge variant="outline">{humanise(row.matchStatus)}</Badge>,
    },
    {
      field: 'paymentStatus',
      headerName: 'Payment',
      width: 140,
      renderCell: (row) => <StatusChip status={row.paymentStatus} />,
    },
  ];

  if (!canRead) {
    return <NotPermitted what="Purchase invoices" capability="the purchase read capability" />;
  }

  return (
    <>
      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SupplierPicker
              id="invoices-supplier"
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                setPage(1);
              }}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="Any status"
              options={enumOptions(PurchaseInvoiceStatus)}
            />
            <SelectField
              label="Payment status"
              value={paymentStatus}
              onChange={(next) => {
                setPaymentStatus(next);
                setPage(1);
              }}
              emptyLabel="Any payment status"
              options={enumOptions(PayableStatus)}
            />
            <SelectField
              label="Match status"
              value={matchStatus}
              onChange={(next) => {
                setMatchStatus(next);
                setPage(1);
              }}
              emptyLabel="Any match status"
              options={enumOptions(MatchStatus)}
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
            <CheckboxField
              label="Overdue only"
              checked={overdueOnly}
              onCheckedChange={(checked) => {
                setOverdueOnly(checked);
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
      />

      {isError ? (
        <LoadError what="Purchase invoices" onRetry={() => void refetch()} />
      ) : (
        <DataTable
          gridId="purchase-invoices"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          onRowDoubleClick={(row) => setOpenId(row.id)}
          emptyTitle="No invoices yet"
          emptyMessage="An invoice is created by posting a purchase entry; there is no other way to raise one."
        />
      )}

      <InvoiceDrawer invoiceId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function InvoiceDrawer({
  invoiceId,
  onClose,
}: {
  invoiceId: string | null;
  onClose: () => void;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = usePurchaseInvoice(invoiceId);
  const flow = usePurchaseDocumentFlow(data?.purchaseEntryId ?? null);

  return (
    <Sheet open={invoiceId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-[900px] sm:max-w-[900px]">
        <SheetHeader>
          <SheetTitle>{data?.invoiceNumber ?? 'Purchase invoice'}</SheetTitle>
          <SheetDescription>
            {data === undefined
              ? 'Invoice detail'
              : `${dash(data.supplierName)} · bill ${dash(data.supplierInvoiceNumber)} · ${formatDate(data.supplierInvoiceDate)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError ? (
            <DrawerError what="This invoice" onRetry={() => void refetch()} />
          ) : data === undefined ? null : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={data.status} />
                <StatusChip status={data.paymentStatus} />
                <Badge variant="outline">{humanise(data.matchStatus)}</Badge>
                <Badge variant="secondary">{humanise(data.paymentMethod)}</Badge>
                {data.isInterState && <Badge variant="outline">Inter-state</Badge>}
              </div>

              <section className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-3 sm:grid-cols-4">
                <Figure label="Taxable" value={money(data.taxableAmount)} />
                <Figure label="CGST" value={money(data.cgstAmount)} />
                <Figure label="SGST" value={money(data.sgstAmount)} />
                <Figure label="IGST" value={money(data.igstAmount)} />
                <Figure label="Cess" value={money(data.cessAmount)} />
                <Figure label="Round off" value={money(data.roundOffAmount)} />
                <Figure label="Total" value={money(data.totalAmount)} strong />
                <Figure label="Outstanding" value={money(data.outstandingAmount)} strong />
                <Figure label="Due date" value={formatDate(data.dueDate)} />
                <Figure label="Credit days" value={String(data.creditDays)} />
                <Figure label="GSTIN" value={dash(data.supplierGstin)} />
                <Figure label="Posted" value={formatDate(data.postedAt)} />
              </section>

              <h3 className="font-heading text-sm font-semibold">Lines</h3>
              {(data.lines ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">This invoice carries no lines.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="text-muted-foreground text-xs">
                        <th className="pb-2 text-left font-normal">#</th>
                        <th className="pb-2 text-left font-normal">Product</th>
                        <th className="pb-2 text-left font-normal">HSN/SAC</th>
                        <th className="pb-2 text-right font-normal">Qty</th>
                        <th className="pb-2 text-right font-normal">Rate</th>
                        <th className="pb-2 text-right font-normal">Discount</th>
                        <th className="pb-2 text-right font-normal">Taxable</th>
                        <th className="pb-2 text-right font-normal">Tax</th>
                        <th className="pb-2 text-right font-normal">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.lines ?? []).map((line, index) => (
                        <tr key={line.id} className="border-t">
                          <td className="text-muted-foreground py-1.5 pr-2 tabular-nums">
                            {index + 1}
                          </td>
                          <td className="py-1.5 pr-2 font-medium">
                            {dash(line.productName ?? line.description)}
                          </td>
                          <td className="text-muted-foreground py-1.5 pr-2">
                            {dash(line.hsnSacCode)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {qty(line.quantity)}
                            {line.uomCode === null || line.uomCode === undefined ? '' : ` ${line.uomCode}`}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{money(line.rate)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {money(line.discountAmount)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {money(line.taxableAmount)}
                          </td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">
                            {money(line.taxAmount)}
                            <span className="text-muted-foreground"> @{line.taxRate}%</span>
                          </td>
                          <td className="py-1.5 text-right font-medium tabular-nums">
                            {money(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data.purchaseEntryId === null ? (
                <p className="text-muted-foreground text-xs">
                  No purchase entry behind this invoice, so there is no chain to trace.
                </p>
              ) : (
                <DocumentFlowPanel
                  flow={flow.data}
                  isLoading={flow.isLoading}
                  error={flow.error}
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------- goods receipts */

function ReceiptsTab(): JSX.Element {
  const { hasCapability } = useAuth();
  const canRead = hasCapability(Capability.PURCHASE_READ);

  const [supplierId, setSupplierId] = useState('');
  const [supplierLabel, setSupplierLabel] = useState('');
  const [status, setStatus] = useState('');
  const [locationId, setLocationId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useMemo<GoodsReceiptListQuery>(() => {
    const built: GoodsReceiptListQuery = { page, pageSize };
    if (supplierId !== '') built.supplierId = supplierId;
    if (status !== '') built.status = status as GoodsReceiptStatus;
    if (locationId !== '') built.locationId = locationId;
    if (dateFrom !== '') built.dateFrom = dateFrom;
    if (dateTo !== '') built.dateTo = dateTo;
    return built;
  }, [supplierId, status, locationId, dateFrom, dateTo, page, pageSize]);

  const { data, isLoading, isError, refetch } = useGoodsReceipts(query, canRead);
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const rows = data?.items ?? [];

  const filterCount =
    (supplierId ? 1 : 0) +
    (status ? 1 : 0) +
    (locationId ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  function resetFilters(): void {
    setSupplierId('');
    setSupplierLabel('');
    setStatus('');
    setLocationId('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const columns: DataTableColumn<GoodsReceiptDto>[] = [
    { field: 'grnNumber', headerName: 'GRN no', width: 180 },
    {
      field: 'receiptDate',
      headerName: 'Date',
      width: 130,
      valueGetter: (row) => formatDate(row.receiptDate),
    },
    {
      field: 'supplierName',
      headerName: 'Supplier',
      width: 200,
      valueGetter: (row) => dash(row.supplierName),
    },
    {
      field: 'locationName',
      headerName: 'Location',
      width: 180,
      valueGetter: (row) => dash(row.locationName),
    },
    {
      field: 'lineCount',
      headerName: 'Lines',
      width: 90,
      align: 'right',
      valueGetter: (row) => row.lineCount ?? 0,
    },
    {
      field: 'deliveryNote',
      headerName: 'Delivery note',
      width: 160,
      valueGetter: (row) => dash(row.deliveryNote),
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      renderCell: (row) => <StatusChip status={row.status} />,
    },
  ];

  if (!canRead) {
    return <NotPermitted what="Goods receipts" capability="the purchase read capability" />;
  }

  return (
    <>
      <ListToolbar
        search=""
        onSearchChange={() => undefined}
        hideSearch
        activeFilterCount={filterCount}
        onClearFilters={resetFilters}
        filters={
          <>
            <SupplierPicker
              id="receipts-supplier"
              value={supplierId}
              displayValue={supplierLabel}
              onChange={(choice) => {
                setSupplierId(choice?.id ?? '');
                setSupplierLabel(choice?.label ?? '');
                setPage(1);
              }}
            />
            <SelectField
              label="Status"
              value={status}
              onChange={(next) => {
                setStatus(next);
                setPage(1);
              }}
              emptyLabel="Any status"
              options={enumOptions(GoodsReceiptStatus)}
            />
            <SelectField
              label="Location"
              value={locationId}
              onChange={(next) => {
                setLocationId(next);
                setPage(1);
              }}
              emptyLabel="Every location"
              options={toOptions(
                locations?.items ?? [],
                (location) => location.id,
                (location) => `${location.code} — ${location.name}`,
              )}
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
      />

      {isError ? (
        <LoadError what="Goods receipts" onRetry={() => void refetch()} />
      ) : (
        <DataTable
          gridId="goods-receipts"
          columns={columns}
          rows={rows}
          getRowId={(row) => row.id}
          loading={isLoading}
          filtered={filterCount > 0}
          onRowDoubleClick={(row) => setOpenId(row.id)}
          emptyTitle="No receipts yet"
          emptyMessage="A goods receipt is created by posting a purchase entry that brought stock in."
        />
      )}

      <ReceiptDrawer receiptId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

function ReceiptDrawer({
  receiptId,
  onClose,
}: {
  receiptId: string | null;
  onClose: () => void;
}): JSX.Element {
  const { data, isLoading, isError, refetch } = useGoodsReceipt(receiptId);
  const flow = usePurchaseDocumentFlow(data?.purchaseEntryId ?? null);

  return (
    <Sheet open={receiptId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-[900px] sm:max-w-[900px]">
        <SheetHeader>
          <SheetTitle>{data?.grnNumber ?? 'Goods receipt'}</SheetTitle>
          <SheetDescription>
            {data === undefined
              ? 'Receipt detail'
              : `${dash(data.supplierName)} · ${dash(data.locationName)} · ${formatDate(data.receiptDate)}`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
          {isLoading ? (
            <DrawerSkeleton />
          ) : isError ? (
            <DrawerError what="This receipt" onRetry={() => void refetch()} />
          ) : data === undefined ? null : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={data.status} />
                {data.deliveryNote !== null && (
                  <Badge variant="outline">Delivery note {data.deliveryNote}</Badge>
                )}
                <span className="text-muted-foreground text-xs">
                  Posted {formatDate(data.postedAt)}
                </span>
              </div>

              <h3 className="font-heading text-sm font-semibold">Lines</h3>
              {(data.lines ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">This receipt carries no lines.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {(data.lines ?? []).map((line, index) => (
                    <div key={line.id} className="rounded-xl border p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">
                          {index + 1}. {dash(line.productName)}
                        </span>
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {money(line.purchaseRate)} per {line.productUnit ?? 'unit'}
                        </span>
                      </div>
                      <div className="text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums">
                        <span>Billed {qty(line.billedQuantity)}</span>
                        <span>Received {qty(line.receivedQuantity)}</span>
                        <span>Accepted {qty(line.acceptedQuantity)}</span>
                        <span>Rejected {qty(line.rejectedQuantity)}</span>
                        <span>Into stock {qty(line.acceptedStockQuantity)}</span>
                        {line.batchNumber !== null && <span>Batch {line.batchNumber}</span>}
                        {line.expiryDate !== null && <span>Expires {formatDate(line.expiryDate)}</span>}
                        <Badge variant="outline">{humanise(line.qcStatus)}</Badge>
                        {line.rejectionReason !== null && (
                          <Badge variant="secondary">{humanise(line.rejectionReason)}</Badge>
                        )}
                      </div>

                      <p className="text-muted-foreground mt-2 text-xs font-medium tracking-[0.06em] uppercase">
                        Destinations
                      </p>
                      {(line.destinations ?? []).length === 0 ? (
                        <p className="text-muted-foreground text-xs">
                          No split recorded — the whole line landed at the receipt&apos;s location.
                        </p>
                      ) : (
                        <table className="mt-1 w-full text-sm">
                          <thead>
                            <tr className="text-muted-foreground text-xs">
                              <th className="pb-1 text-left font-normal">Location</th>
                              <th className="pb-1 text-left font-normal">Kind</th>
                              <th className="pb-1 text-right font-normal">Quantity</th>
                              <th className="pb-1 text-left font-normal">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(line.destinations ?? []).map((destination) => (
                              <tr key={destination.id} className="border-t">
                                <td className="py-1 pr-2 font-medium">
                                  {dash(destination.locationName)}
                                </td>
                                <td className="text-muted-foreground py-1 pr-2">
                                  {destination.locationKind === undefined
                                    ? '—'
                                    : humanise(destination.locationKind)}
                                </td>
                                <td className="py-1 pr-2 text-right tabular-nums">
                                  {qty(destination.quantity)}
                                </td>
                                <td className="text-muted-foreground py-1">
                                  {dash(destination.notes)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {data.purchaseEntryId === null ? (
                <p className="text-muted-foreground text-xs">
                  No purchase entry behind this receipt, so there is no chain to trace.
                </p>
              ) : (
                <DocumentFlowPanel
                  flow={flow.data}
                  isLoading={flow.isLoading}
                  error={flow.error}
                />
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* --------------------------------------------------------------------------- shared */

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-muted-foreground text-xs font-medium tracking-[0.06em] uppercase">
        {label}
      </span>
      <span
        className={
          strong === true ? 'text-base font-bold tabular-nums' : 'text-sm font-semibold tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}

function DrawerSkeleton(): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }, (_unused, index) => (
        <Skeleton key={index} className="h-8 rounded-md" />
      ))}
    </div>
  );
}

function DrawerError({ what, onRetry }: { what: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-sm font-medium">{what} could not be loaded.</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
