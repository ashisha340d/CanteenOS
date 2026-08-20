import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Capability,
  MasterStatus,
  PayableStatus,
  PurchaseEntryStatus,
  PurchasePaymentMethod,
  PurchaseType,
  type PurchaseRegisterQuery,
  type PurchaseRegisterRowDto,
} from '@menuboard/shared';
import {
  MARG_BEVEL_OUT,
  MARG_BTN,
  MARG_FIELD,
  MARG_LABEL,
  margAmount,
} from '../Pos/margChrome';
import { useVendors } from '../../hooks/usePurchase';
import { usePurchaseRegister, usePurchaseRegisterTotals } from '../../hooks/usePurchaseEntry';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const PAGE_SIZE = 200;

function iso(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, '0');
  const day = String(when.getDate()).padStart(2, '0');
  return `${when.getFullYear()}-${month}-${day}`;
}

function isoToDmy(value: string | null): string {
  if (value === null || value === '') return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  if (y === undefined || m === undefined || d === undefined) return '';
  return `${d}-${m}-${y}`;
}

function ddmmyyyy(when: Date): string {
  return when.toLocaleDateString('en-GB').replace(/\//g, '-');
}

function dateBar(when: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(when);
  return `${ddmmyyyy(when)}|${day}`;
}

function monthStart(): string {
  const now = new Date();
  return iso(new Date(now.getFullYear(), now.getMonth(), 1));
}

const STATUS_TINT: Record<string, string> = {
  [PurchaseEntryStatus.DRAFT]: 'text-[#5f7370]',
  [PurchaseEntryStatus.READY]: 'text-[#2b5b84]',
  [PurchaseEntryStatus.POSTED]: 'text-[#0d5b57] font-bold',
  [PurchaseEntryStatus.CANCELLED]: 'text-[#a80000]',
};

/**
 * The purchase day book. Dense on purpose: an accountant reads a fortnight of buying by
 * scanning down a column, and the footer is the number they actually write down.
 */
export function PurchaseRegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability, user } = useAuth();
  const canCreate = hasCapability(Capability.PURCHASE_ENTRY_CREATE);

  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(() => iso(new Date()));
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [purchaseType, setPurchaseType] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [selected, setSelected] = useState(0);
  const [clock, setClock] = useState(() => CLOCK.format(new Date()));

  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(CLOCK.format(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const vendorQuery = useMemo(() => ({ page: 1, pageSize: 200, status: MasterStatus.ACTIVE }), []);
  const { data: vendorPage } = useVendors(vendorQuery);
  const vendors = vendorPage?.items ?? [];

  const query = useMemo<PurchaseRegisterQuery>(() => {
    const built: PurchaseRegisterQuery = { page: 1, pageSize: PAGE_SIZE };
    if (dateFrom !== '') built.dateFrom = dateFrom;
    if (dateTo !== '') built.dateTo = dateTo;
    if (supplierId !== '') built.supplierId = supplierId;
    if (status !== '') built.status = status as PurchaseEntryStatus;
    if (paymentMethod !== '') built.paymentMethod = paymentMethod as PurchasePaymentMethod;
    if (paymentStatus !== '') built.paymentStatus = paymentStatus as PayableStatus;
    if (purchaseType !== '') built.purchaseType = purchaseType as PurchaseType;
    if (amountMin.trim() !== '' && Number.isFinite(Number(amountMin)))
      built.amountMin = Number(amountMin);
    if (amountMax.trim() !== '' && Number.isFinite(Number(amountMax)))
      built.amountMax = Number(amountMax);
    if (exceptionsOnly) built.withExceptionsOnly = true;
    return built;
  }, [
    amountMax,
    amountMin,
    dateFrom,
    dateTo,
    exceptionsOnly,
    paymentMethod,
    paymentStatus,
    purchaseType,
    status,
    supplierId,
  ]);

  const register = usePurchaseRegister(query);
  const totalsQuery = usePurchaseRegisterTotals(query);

  const rows: PurchaseRegisterRowDto[] = useMemo(
    () => register.data?.items ?? [],
    [register.data],
  );

  /** The endpoint is authoritative; `meta.totals` is the same figure arriving with the page. */
  const totals = totalsQuery.data ?? register.data?.meta.totals ?? null;

  useEffect(() => {
    if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
  }, [rows.length, selected]);

  useEffect(() => {
    rowRefs.current.get(selected)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const openRow = useCallback(
    (row: PurchaseRegisterRowDto | undefined) => {
      if (row === undefined) return;
      navigate(`/purchase/entry?entryId=${row.entryId}`);
    },
    [navigate],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);
      if (event.key === 'F2' && canCreate) {
        event.preventDefault();
        navigate('/purchase/entry');
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        navigate('/');
        return;
      }
      if (typing && event.key !== 'Enter') return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelected((index) => Math.min(index + 1, rows.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Enter' && !typing) {
        event.preventDefault();
        openRow(rows[selected]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, navigate, openRow, rows, selected]);

  const today = useMemo(() => new Date(), []);
  const errorText =
    register.error === null || register.error === undefined
      ? null
      : readError(register.error).message.toUpperCase();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#dfe6e2] font-mono text-[13px] text-black">
      <div className="flex shrink-0 items-center gap-1 bg-[#3d6382] px-1.5 py-[2px] text-[11px] leading-[14px] text-white">
        <span className="font-bold">MARG ERP 9+</span>
        <span className="truncate">
          |Gold-99 User|Series E- {ddmmyyyy(today)}|REGISTER|
          {supplierId === ''
            ? 'ALL SUPPLIERS'
            : (vendors.find((v) => v.id === supplierId)?.name.toUpperCase() ?? 'SUPPLIER')}
          |USER-{(user?.username ?? 'MARG').toUpperCase()}
        </span>
      </div>

      <div className="shrink-0 border-b border-[#9aa8a4] px-1.5 py-[1px] text-[11px] leading-[14px]">
        Marg
      </div>

      <div className="flex shrink-0 items-center justify-between bg-[#2e6f6a] px-1.5 py-[2px] text-white">
        <span className="font-bold tracking-[0.06em]">PURCHASE REGISTER</span>
        <span className="flex items-center gap-2">
          <span className="text-[12px]">{dateBar(today)}</span>
          <span className="bg-black px-1.5 font-bold text-[#ff9c00] tabular-nums">{clock}</span>
        </span>
      </div>

      {/* ------------------------------------------------------------- filters */}
      <div className="grid shrink-0 grid-cols-[5rem_8rem_5rem_8rem_6rem_minmax(9rem,1fr)_6rem_8rem] items-center gap-x-2 gap-y-[3px] px-2 py-1.5">
        <span className={MARG_LABEL}>From :</span>
        <input
          type="date"
          value={dateFrom}
          className={`${MARG_FIELD} tabular-nums`}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <span className={MARG_LABEL}>To :</span>
        <input
          type="date"
          value={dateTo}
          className={`${MARG_FIELD} tabular-nums`}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <span className={MARG_LABEL}>Supplier:</span>
        <select
          value={supplierId}
          className={`${MARG_FIELD} cursor-pointer`}
          onChange={(event) => setSupplierId(event.target.value)}
        >
          <option value="">ALL</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.code} · {vendor.name.toUpperCase()}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>Status :</span>
        <select
          value={status}
          className={`${MARG_FIELD} cursor-pointer`}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">ALL</option>
          {Object.values(PurchaseEntryStatus).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>

        <span className={MARG_LABEL}>Pay Mode:</span>
        <select
          value={paymentMethod}
          className={`${MARG_FIELD} cursor-pointer`}
          onChange={(event) => setPaymentMethod(event.target.value)}
        >
          <option value="">ALL</option>
          {Object.values(PurchasePaymentMethod).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>Pay Sts:</span>
        <select
          value={paymentStatus}
          className={`${MARG_FIELD} cursor-pointer`}
          onChange={(event) => setPaymentStatus(event.target.value)}
        >
          <option value="">ALL</option>
          {Object.values(PayableStatus).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>Type :</span>
        <select
          value={purchaseType}
          className={`${MARG_FIELD} cursor-pointer`}
          onChange={(event) => setPurchaseType(event.target.value)}
        >
          <option value="">ALL</option>
          {Object.values(PurchaseType).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>Amount :</span>
        <span className="flex items-center gap-1">
          <input
            value={amountMin}
            inputMode="decimal"
            placeholder="MIN"
            className={`${MARG_FIELD} text-right tabular-nums`}
            onChange={(event) => setAmountMin(event.target.value)}
          />
          <input
            value={amountMax}
            inputMode="decimal"
            placeholder="MAX"
            className={`${MARG_FIELD} text-right tabular-nums`}
            onChange={(event) => setAmountMax(event.target.value)}
          />
          <label className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            <input
              type="checkbox"
              className="size-[12px] accent-[#2e6f6a]"
              checked={exceptionsOnly}
              onChange={(event) => setExceptionsOnly(event.target.checked)}
            />
            <span className={`text-[11px] font-bold ${MARG_LABEL}`}>EXC ONLY</span>
          </label>
        </span>
      </div>

      {/* ---------------------------------------------------------- the day book */}
      <div className="min-h-0 flex-1 overflow-auto border-y border-[#7d9490] bg-[#e8ede9]">
        <table className="w-full min-w-[92rem] table-fixed border-collapse">
          <colgroup>
            <col className="w-[6rem]" />
            <col className="w-[8rem]" />
            <col />
            <col className="w-[8rem]" />
            <col className="w-[6rem]" />
            <col className="w-[5rem]" />
            <col className="w-[3.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[6rem]" />
            <col className="w-[6rem]" />
            <col className="w-[6rem]" />
            <col className="w-[7.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[7rem]" />
            <col className="w-[5rem]" />
            <col className="w-[6rem]" />
            <col className="w-[7rem]" />
            <col className="w-[7rem]" />
            <col className="w-[4rem]" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-[#dfe6e2]">
            <tr
              className={`${MARG_LABEL} [&>th]:border-y [&>th]:border-[#7d9490] [&>th]:px-1 [&>th]:py-[2px] [&>th]:font-bold [&>th]:tracking-[0.04em]`}
            >
              <th className="text-left">DATE</th>
              <th className="text-left">ENTRY NO</th>
              <th className="text-left">SUPPLIER</th>
              <th className="text-left">BILL NO</th>
              <th className="text-left">BILL DATE</th>
              <th className="text-left">TYPE</th>
              <th className="text-right">ITEMS</th>
              <th className="text-right">TAXABLE</th>
              <th className="text-right">CGST</th>
              <th className="text-right">SGST</th>
              <th className="text-right">IGST</th>
              <th className="text-right">TOTAL</th>
              <th className="text-right">PAID</th>
              <th className="text-right">OUTSTANDING</th>
              <th className="text-left">PAY MODE</th>
              <th className="text-left">STATUS</th>
              <th className="text-left">GRN</th>
              <th className="text-left">INVOICE</th>
              <th className="text-right">EXC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.entryId}
                ref={(element) => {
                  if (element === null) rowRefs.current.delete(index);
                  else rowRefs.current.set(index, element);
                }}
                className={`cursor-pointer uppercase [&>td]:truncate [&>td]:px-1 [&>td]:leading-[20px] ${
                  index === selected ? 'bg-[#cfe0dc]' : ''
                }`}
                onClick={() => {
                  setSelected(index);
                  openRow(row);
                }}
              >
                <td className="tabular-nums">{isoToDmy(row.businessDate)}</td>
                <td className="font-bold">{row.entryNumber}</td>
                <td>{row.supplierName}</td>
                <td>{row.supplierInvoiceNumber ?? ''}</td>
                <td className="tabular-nums">{isoToDmy(row.supplierInvoiceDate)}</td>
                <td>{row.purchaseType}</td>
                <td className="text-right tabular-nums">{row.lineCount}</td>
                <td className="text-right tabular-nums">{margAmount(row.taxableAmount)}</td>
                <td className="text-right tabular-nums">{margAmount(row.cgstAmount)}</td>
                <td className="text-right tabular-nums">{margAmount(row.sgstAmount)}</td>
                <td className="text-right tabular-nums">{margAmount(row.igstAmount)}</td>
                <td className="text-right font-bold tabular-nums">
                  {margAmount(row.totalAmount)}
                </td>
                <td className="text-right tabular-nums">{margAmount(row.paidAmount)}</td>
                <td className="text-right tabular-nums">{margAmount(row.outstandingAmount)}</td>
                <td>{row.paymentMethod}</td>
                <td className={STATUS_TINT[row.status] ?? ''}>{row.status}</td>
                <td>{row.grnNumber ?? ''}</td>
                <td>{row.invoiceNumber ?? ''}</td>
                <td
                  className={`text-right tabular-nums ${
                    row.openExceptionCount > 0 ? 'bg-[#a80000] font-bold text-white' : ''
                  }`}
                >
                  {row.openExceptionCount > 0 ? row.openExceptionCount : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={19} className={`px-2 py-2 ${MARG_LABEL}`}>
                  {register.isLoading
                    ? 'LOADING REGISTER…'
                    : errorText !== null
                      ? ''
                      : 'NO ENTRIES FOR THIS FILTER'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* -------------------------------------------------- whole-filter totals */}
      <div
        className={`shrink-0 overflow-hidden bg-[#d6e3ec] ${MARG_BEVEL_OUT} px-0 py-0`}
      >
        <table className="w-full min-w-[92rem] table-fixed border-collapse">
          <colgroup>
            <col className="w-[6rem]" />
            <col className="w-[8rem]" />
            <col />
            <col className="w-[8rem]" />
            <col className="w-[6rem]" />
            <col className="w-[5rem]" />
            <col className="w-[3.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[6rem]" />
            <col className="w-[6rem]" />
            <col className="w-[6rem]" />
            <col className="w-[7.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[7rem]" />
            <col className="w-[5rem]" />
            <col className="w-[6rem]" />
            <col className="w-[7rem]" />
            <col className="w-[7rem]" />
            <col className="w-[4rem]" />
          </colgroup>
          <tbody>
            <tr className="[&>td]:px-1 [&>td]:leading-[20px] [&>td]:font-bold">
              <td colSpan={6} className={MARG_LABEL}>
                TOTALS · {totals === null ? '—' : totals.entryCount} ENTRIES
                {totalsQuery.isError ? ' · TOTALS UNAVAILABLE' : ''}
              </td>
              <td className="text-right tabular-nums" />
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.taxableAmount)}
              </td>
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.cgstAmount)}
              </td>
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.sgstAmount)}
              </td>
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.igstAmount)}
              </td>
              <td className="text-right text-[15px] tabular-nums">
                {totals === null ? '' : margAmount(totals.totalAmount)}
              </td>
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.paidAmount)}
              </td>
              <td className="text-right tabular-nums">
                {totals === null ? '' : margAmount(totals.outstandingAmount)}
              </td>
              <td colSpan={5} />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#7d9490] px-2 text-[11px] leading-[15px]">
        <span className={MARG_LABEL}>
          Rows:{rows.length}
          {register.data !== undefined ? ` of ${register.data.meta.total}` : ''} · Selected:
          {rows.length === 0 ? 0 : selected + 1}
        </span>
        {errorText !== null && (
          <span role="alert" className="bg-[#a80000] px-1 font-bold text-white">
            {errorText}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t-2 border-[#9aa8a4] bg-[#dfe6e2] px-1 py-[2px]">
        <span aria-hidden className="px-1 text-[14px] leading-none text-[#a80000]">
          ◀
        </span>
        <button
          type="button"
          className={`${MARG_BTN} bg-[#a80000] font-bold text-white disabled:text-[#e0c0c0]`}
          disabled={!canCreate}
          onClick={() => navigate('/purchase/entry')}
        >
          New F2
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={rows.length === 0}
          onClick={() => openRow(rows[selected])}
        >
          Open Enter
        </button>
        <button
          type="button"
          className={MARG_BTN}
          onClick={() => {
            void register.refetch();
            void totalsQuery.refetch();
          }}
        >
          Refresh
        </button>
        <div className="flex-1" />
        <button type="button" className={MARG_BTN} onClick={() => navigate('/')}>
          Exit Esc
        </button>
      </div>
    </div>
  );
}
