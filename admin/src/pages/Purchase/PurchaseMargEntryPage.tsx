import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Capability,
  ExceptionSeverity,
  MasterStatus,
  PurchaseEntryStatus,
  PurchasePaymentMethod,
  PurchaseType,
  type InventoryLocationDto,
  type ProductDto,
  type PurchaseEntryDto,
  type PurchaseEntryLineInput,
  type PurchaseExceptionCode,
  type PurchaseExceptionDto,
  type VendorSummaryDto,
} from '@menuboard/shared';
import {
  MARG_BEVEL_OUT,
  MARG_BTN,
  MARG_CELL,
  MARG_FIELD,
  MARG_LABEL,
  margAmount,
  readPref,
  writePref,
} from '../Pos/margChrome';
import {
  PurchaseExceptionStrip,
  blockingExceptions,
  openExceptions,
} from './PurchaseExceptionStrip';
import { PurchaseMargPaymentModal } from './PurchaseMargPaymentModal';
import { DocumentFlowPanel } from './DocumentFlowPanel';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import { useInventoryLocations, useProducts, useVendors } from '../../hooks/usePurchase';
import {
  useCreatePurchaseEntry,
  usePurchaseDocumentFlow,
  usePurchaseEntry,
  usePurchasePostPreview,
  useReadyPurchaseEntry,
  useUpdatePurchaseEntry,
} from '../../hooks/usePurchaseEntry';

/* ------------------------------------------------------------------ line model --- */

/** The editable columns, in tab order. UNIT, GST% and AMOUNT are computed and never focused. */
const COLUMNS = [
  'product',
  'qty',
  'rate',
  'disc',
  'batch',
  'expiry',
  'recd',
  'accpt',
  'rej',
  'dest',
] as const;
type ColumnId = (typeof COLUMNS)[number];

interface EntryLine {
  key: string;
  lineId: string | null;
  productId: string | null;
  name: string;
  unit: string;
  qty: string;
  rate: string;
  disc: string;
  batch: string;
  expiry: string;
  recd: string;
  accpt: string;
  rej: string;
  dest: string;
  taxRate: number | null;
  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  lastPurchaseRate: number | null;
  stockOnHand: number | null;
  /**
   * RECD follows QTY and ACCPT follows RECD until the operator says otherwise. A clean
   * delivery therefore needs no keystrokes at all in those three columns.
   */
  recdTouched: boolean;
  acceptTouched: boolean;
  rejTouched: boolean;
  destTouched: boolean;
  /** The server's own figure for this line, shown once a save has returned. */
  serverAmount: number | null;
}

const TYPE_PREF = 'purchase-marg-type';
const PAY_PREF = 'purchase-marg-pay';
const LOCATION_PREF = 'purchase-marg-location';

const PURCHASE_TYPES: PurchaseType[] = [
  PurchaseType.STOCK,
  PurchaseType.EXPENSE,
  PurchaseType.ASSET,
  PurchaseType.OTHER,
];

const PAYMENT_METHODS: PurchasePaymentMethod[] = [
  PurchasePaymentMethod.CASH,
  PurchasePaymentMethod.UPI,
  PurchasePaymentMethod.BANK,
  PurchasePaymentMethod.CARD,
  PurchasePaymentMethod.CHEQUE,
  PurchasePaymentMethod.CREDIT,
];

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const EDITABLE_STATUSES: PurchaseEntryStatus[] = [
  PurchaseEntryStatus.DRAFT,
  PurchaseEntryStatus.READY,
];

/* -------------------------------------------------------------------- helpers --- */

function num(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function lineKey(): string {
  return `pline-${crypto.randomUUID()}`;
}

function blankLine(): EntryLine {
  return {
    key: lineKey(),
    lineId: null,
    productId: null,
    name: '',
    unit: '',
    qty: '',
    rate: '',
    disc: '',
    batch: '',
    expiry: '',
    recd: '',
    accpt: '',
    rej: '',
    dest: '',
    taxRate: null,
    isBatchTracked: false,
    isExpiryTracked: false,
    lastPurchaseRate: null,
    stockOnHand: null,
    recdTouched: false,
    acceptTouched: false,
    rejTouched: false,
    destTouched: false,
    serverAmount: null,
  };
}

function isFilled(line: EntryLine): boolean {
  return line.name.trim() !== '';
}

function lineGross(line: EntryLine): number {
  return round2(num(line.qty) * num(line.rate));
}

function lineDiscount(line: EntryLine): number {
  const percent = Math.min(100, Math.max(0, num(line.disc)));
  return round2((lineGross(line) * percent) / 100);
}

function lineTaxable(line: EntryLine): number {
  return round2(lineGross(line) - lineDiscount(line));
}

function lineTax(line: EntryLine): number {
  return round2((lineTaxable(line) * (line.taxRate ?? 0)) / 100);
}

function lineTotal(line: EntryLine): number {
  return round2(lineTaxable(line) + lineTax(line));
}

function ddmmyyyy(when: Date): string {
  return when.toLocaleDateString('en-GB').replace(/\//g, '-');
}

function dateBar(when: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(when);
  return `${ddmmyyyy(when)}|${day}`;
}

function isoToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** `DD-MM-YYYY` / `DD/MM/YYYY` into an ISO date. Anything else is not a date. */
function parseDmy(text: string): string | null {
  const match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(text.trim());
  if (match === null) return null;
  const [, d, m, y] = match;
  if (d === undefined || m === undefined || y === undefined) return null;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Expiry as printed on the pack. Suppliers write `MM/YY`, so a month-only entry means the
 * last day of that month — an item marked 03/26 is good through 31 March 2026.
 */
function parseExpiry(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const full = parseDmy(trimmed);
  if (full !== null) return full;
  const match = /^(\d{1,2})[-/.](\d{2}|\d{4})$/.exec(trimmed);
  if (match === null) return null;
  const [, m, y] = match;
  if (m === undefined || y === undefined) return null;
  const month = Number(m);
  if (month < 1 || month > 12) return null;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const last = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function isoToDmy(iso: string | null): string {
  if (iso === null || iso === '') return '';
  const [y, m, d] = iso.split('-');
  if (y === undefined || m === undefined || d === undefined) return '';
  return `${d}-${m}-${y}`;
}

/* ------------------------------------------------------------------- the page --- */

export function PurchaseMargEntryPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasCapability, user } = useAuth();
  const canCreate = hasCapability(Capability.PURCHASE_ENTRY_CREATE);
  const canPost = hasCapability(Capability.PURCHASE_POST);

  const entryId = params.get('entryId');

  /* ------------------------------------------------------------------- header */
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [party, setParty] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(() => ddmmyyyy(new Date()));
  const [purchaseType, setPurchaseType] = useState<PurchaseType>(() => {
    const saved = readPref(TYPE_PREF);
    return PURCHASE_TYPES.includes(saved as PurchaseType)
      ? (saved as PurchaseType)
      : PurchaseType.STOCK;
  });
  const [paymentMethod, setPaymentMethod] = useState<PurchasePaymentMethod>(() => {
    const saved = readPref(PAY_PREF);
    return PAYMENT_METHODS.includes(saved as PurchasePaymentMethod)
      ? (saved as PurchasePaymentMethod)
      : PurchasePaymentMethod.CREDIT;
  });
  const [dueDate, setDueDate] = useState('');
  const [locationId, setLocationId] = useState<string>(() => readPref(LOCATION_PREF) ?? '');
  const [remark, setRemark] = useState('');

  /* -------------------------------------------------------------------- lines */
  const [lines, setLines] = useState<EntryLine[]>(() => [blankLine()]);
  const [cursor, setCursor] = useState<{ row: number; col: ColumnId }>({ row: 0, col: 'product' });
  const [focusTarget, setFocusTarget] = useState<{ row: number; col: ColumnId } | null>(null);

  /* ------------------------------------------------------------------- pickers */
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [partyPickerOpen, setPartyPickerOpen] = useState(false);
  const [partyIndex, setPartyIndex] = useState(0);

  /* ------------------------------------------------------------------- session */
  const [serverEntry, setServerEntry] = useState<PurchaseEntryDto | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [acceptedCodes, setAcceptedCodes] = useState<PurchaseExceptionCode[]>([]);
  const [clock, setClock] = useState(() => CLOCK.format(new Date()));

  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const pickRefs = useRef(new Map<number, HTMLButtonElement>());
  const forcePicker = useRef(false);
  const partyRef = useRef<HTMLInputElement>(null);
  const billNoRef = useRef<HTMLInputElement>(null);
  const billDateRef = useRef<HTMLInputElement>(null);
  const typeRef = useRef<HTMLSelectElement>(null);
  const paymentRef = useRef<HTMLSelectElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLSelectElement>(null);
  const remarkRef = useRef<HTMLInputElement>(null);

  /** Guards the hydrate effect: a re-render must not overwrite what the operator has typed. */
  const hydrated = useRef<string | null>(null);

  const loaded = usePurchaseEntry(entryId);
  const createEntry = useCreatePurchaseEntry();
  const updateEntry = useUpdatePurchaseEntry();
  const markReady = useReadyPurchaseEntry();
  const busy = createEntry.isPending || updateEntry.isPending || markReady.isPending;

  const status = serverEntry?.status ?? PurchaseEntryStatus.DRAFT;
  const isPosted = status === PurchaseEntryStatus.POSTED;
  const locked = serverEntry !== null && !EDITABLE_STATUSES.includes(status);
  const canEdit = canCreate && !locked;

  const preview = usePurchasePostPreview(serverEntry?.id ?? null, !dirty);
  const flow = usePurchaseDocumentFlow(serverEntry?.id ?? null);

  /* -------------------------------------------------------------- master data */

  const vendorQuery = useMemo(
    () => ({ page: 1, pageSize: 200, status: MasterStatus.ACTIVE }),
    [],
  );
  const { data: vendorPage, isLoading: vendorsLoading } = useVendors(vendorQuery);
  const vendors = useMemo(() => vendorPage?.items ?? [], [vendorPage]);

  const productQuery = useMemo(
    () => ({
      page: 1,
      pageSize: 300,
      status: MasterStatus.ACTIVE,
      purchasableOnly: true,
      includeStock: true,
    }),
    [],
  );
  const { data: productPage, isLoading: productsLoading } = useProducts(productQuery);
  const products = useMemo(() => productPage?.items ?? [], [productPage]);

  const locationQuery = useMemo(
    () => ({ page: 1, pageSize: 200, status: MasterStatus.ACTIVE }),
    [],
  );
  const { data: locationPage } = useInventoryLocations(locationQuery);
  const locations = useMemo(() => locationPage?.items ?? [], [locationPage]);

  const locationById = useMemo(() => {
    const map = new Map<string, InventoryLocationDto>();
    for (const location of locations) map.set(location.id, location);
    return map;
  }, [locations]);

  const locationByCode = useMemo(() => {
    const map = new Map<string, InventoryLocationDto>();
    for (const location of locations) map.set(location.code.toUpperCase(), location);
    return map;
  }, [locations]);

  const headerLocationCode =
    locationId === '' ? '' : (locationById.get(locationId)?.code.toUpperCase() ?? '');

  /** The default receiving location, chosen once when the operator has expressed no preference. */
  useEffect(() => {
    if (locationId !== '' || locations.length === 0) return;
    const preferred = locations.find((location) => location.isDefaultReceiving) ?? locations[0];
    if (preferred !== undefined) setLocationId(preferred.id);
  }, [locationId, locations]);

  /* ------------------------------------------------------------------- clock */
  useEffect(() => {
    const timer = window.setInterval(() => setClock(CLOCK.format(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* ------------------------------------------------------ hydrate from server */
  useEffect(() => {
    const entry = loaded.data;
    if (entry === undefined) return;
    const stamp = `${entry.id}:${entry.revision}`;
    if (hydrated.current === stamp) return;
    hydrated.current = stamp;
    setServerEntry(entry);
    setDirty(false);
    setSupplierId(entry.supplierId);
    setParty(entry.supplierName ?? '');
    setBillNo(entry.supplierInvoiceNumber ?? '');
    setBillDate(isoToDmy(entry.supplierInvoiceDate));
    setPurchaseType(entry.purchaseType);
    setPaymentMethod(entry.paymentMethod);
    setDueDate(isoToDmy(entry.dueDate));
    if (entry.receivingLocationId !== null) setLocationId(entry.receivingLocationId);
    setRemark(entry.notes ?? '');
    const rows = (entry.lines ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map<EntryLine>((line) => ({
        key: lineKey(),
        lineId: line.id,
        productId: line.productId,
        name: line.productName ?? line.description ?? '',
        unit: line.stockUomCode ?? line.productUnit ?? '',
        qty: String(line.quantity),
        rate: String(line.rate),
        disc: line.discountPercent > 0 ? String(line.discountPercent) : '',
        batch: line.batchNumber ?? '',
        expiry: isoToDmy(line.expiryDate),
        recd: String(line.receivedQuantity),
        accpt: String(line.acceptedQuantity),
        rej: line.rejectedQuantity > 0 ? String(line.rejectedQuantity) : '',
        dest: line.destinationLocationId ?? '',
        taxRate: line.taxRate,
        isBatchTracked: line.isBatchTracked ?? false,
        isExpiryTracked: line.isExpiryTracked ?? false,
        lastPurchaseRate: line.lastPurchaseRate ?? null,
        stockOnHand: null,
        recdTouched: true,
        acceptTouched: true,
        rejTouched: true,
        destTouched: true,
        serverAmount: line.lineTotal,
      }))
      .map((line) => ({
        ...line,
        dest:
          line.dest === '' ? '' : (locationById.get(line.dest)?.code.toUpperCase() ?? line.dest),
      }));
    setLines(rows.length > 0 ? [...rows, blankLine()] : [blankLine()]);
  }, [loaded.data, locationById]);

  /* ------------------------------------------------- always one blank tail row */
  useEffect(() => {
    setLines((rows) => {
      const last = rows[rows.length - 1];
      if (last !== undefined && !isFilled(last)) return rows;
      return [...rows, blankLine()];
    });
  }, [lines]);

  /* --------------------------------------------------------------- focus move */
  useEffect(() => {
    if (focusTarget === null) return;
    const row = lines[focusTarget.row];
    if (row === undefined) return;
    const input = cellRefs.current.get(`${row.key}:${focusTarget.col}`);
    if (input !== undefined) {
      input.focus();
      input.select();
    }
    setFocusTarget(null);
  }, [focusTarget, lines]);

  useEffect(() => {
    if (pickerKey === null) return;
    pickRefs.current.get(pickIndex)?.scrollIntoView({ block: 'nearest' });
  }, [pickIndex, pickerKey]);

  const today = useMemo(() => new Date(), []);

  /* ------------------------------------------------------------ line plumbing */

  const touch = useCallback(() => {
    setDirty(true);
  }, []);

  const updateLine = useCallback(
    (key: string, patch: Partial<EntryLine>) => {
      setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
      touch();
    },
    [touch],
  );

  const removeLine = useCallback(
    (key: string) => {
      setLines((rows) => rows.filter((row) => row.key !== key));
      touch();
    },
    [touch],
  );

  /** QTY drives RECD drives ACCPT, until the operator overrules any of them. */
  const setQty = useCallback(
    (key: string, value: string) => {
      setLines((rows) =>
        rows.map((row) => {
          if (row.key !== key) return row;
          const next: EntryLine = { ...row, qty: value };
          if (!row.recdTouched) next.recd = value;
          if (!row.acceptTouched) next.accpt = next.recd;
          if (!row.rejTouched) next.rej = '';
          return next;
        }),
      );
      touch();
    },
    [touch],
  );

  const setRecd = useCallback(
    (key: string, value: string) => {
      setLines((rows) =>
        rows.map((row) => {
          if (row.key !== key) return row;
          const next: EntryLine = { ...row, recd: value, recdTouched: true };
          if (!row.acceptTouched) next.accpt = value;
          if (!row.rejTouched) next.rej = '';
          return next;
        }),
      );
      touch();
    },
    [touch],
  );

  const setAccpt = useCallback(
    (key: string, value: string) => {
      setLines((rows) =>
        rows.map((row) => {
          if (row.key !== key) return row;
          const next: EntryLine = { ...row, accpt: value, acceptTouched: true };
          if (!row.rejTouched) {
            const short = round2(num(row.recd) - num(value));
            next.rej = short > 0 ? String(short) : '';
          }
          return next;
        }),
      );
      touch();
    },
    [touch],
  );

  const applyProduct = useCallback(
    (key: string, product: ProductDto) => {
      const rate = product.lastPurchaseRate ?? product.standardCost ?? null;
      const destination =
        product.defaultLocationId !== null
          ? (locationById.get(product.defaultLocationId)?.code.toUpperCase() ?? '')
          : headerLocationCode;
      updateLine(key, {
        productId: product.id,
        name: product.name,
        unit: (product.stockUomCode ?? product.unit ?? '').toUpperCase(),
        rate: rate === null ? '' : String(rate),
        qty: '',
        recd: '',
        accpt: '',
        rej: '',
        batch: '',
        expiry: '',
        dest: destination,
        taxRate: product.taxRate ?? null,
        isBatchTracked: product.isBatchTracked,
        isExpiryTracked: product.isExpiryTracked,
        lastPurchaseRate: product.lastPurchaseRate,
        stockOnHand: product.stockOnHand ?? null,
        recdTouched: false,
        acceptTouched: false,
        rejTouched: false,
        destTouched: false,
        serverAmount: null,
      });
      setPickerKey(null);
      setPickIndex(0);
    },
    [headerLocationCode, locationById, updateLine],
  );

  /* ------------------------------------------------------------- suggestions */

  const pickerRow = pickerKey === null ? null : (lines.find((row) => row.key === pickerKey) ?? null);

  const suggestions = useMemo(() => {
    if (pickerRow === null) return [];
    const q = pickerRow.name.trim().toLowerCase();
    const matches =
      q === ''
        ? products
        : products.filter((product) =>
          `${product.name} ${product.code ?? ''} ${product.barcode ?? ''} ${product.brand ?? ''}`
            .toLowerCase()
            .includes(q),
        );
    return matches.slice(0, 60);
  }, [pickerRow, products]);

  const pickerOpen = pickerKey !== null && suggestions.length > 0;

  const partySuggestions = useMemo(() => {
    const q = party.trim().toLowerCase();
    const matches =
      q === ''
        ? vendors
        : vendors.filter((vendor) =>
          `${vendor.name} ${vendor.code} ${vendor.gstin ?? ''}`.toLowerCase().includes(q),
        );
    return matches.slice(0, 40);
  }, [party, vendors]);

  const applyVendor = useCallback(
    (vendor: VendorSummaryDto) => {
      setSupplierId(vendor.id);
      setParty(vendor.name);
      setPartyPickerOpen(false);
      setPartyIndex(0);
      setDirty(true);
      if (vendor.profile.defaultLocationId !== null) {
        setLocationId(vendor.profile.defaultLocationId);
      }
    },
    [],
  );

  /* ----------------------------------------------------------------- figures */

  const filledLines = useMemo(() => lines.filter(isFilled), [lines]);

  const clientTotals = useMemo(() => {
    const interState = serverEntry?.isInterState ?? false;
    const gross = filledLines.reduce((sum, line) => sum + lineGross(line), 0);
    const discount = filledLines.reduce((sum, line) => sum + lineDiscount(line), 0);
    const taxable = filledLines.reduce((sum, line) => sum + lineTaxable(line), 0);
    const tax = filledLines.reduce((sum, line) => sum + lineTax(line), 0);
    const otherCharges = serverEntry?.otherCharges ?? 0;
    const raw = taxable + tax + otherCharges;
    const roundOff = round2(Math.round(raw) - raw);
    const total = round2(raw + roundOff);
    const paid = serverEntry?.paidAmount ?? 0;
    return {
      subtotalAmount: round2(gross),
      discountAmount: round2(discount),
      taxableAmount: round2(taxable),
      cgstAmount: interState ? 0 : round2(tax / 2),
      sgstAmount: interState ? 0 : round2(tax / 2),
      igstAmount: interState ? round2(tax) : 0,
      cessAmount: 0,
      taxAmount: round2(tax),
      otherCharges,
      roundOffAmount: roundOff,
      totalAmount: total,
      paidAmount: paid,
      outstandingAmount: round2(total - paid),
    };
  }, [filledLines, serverEntry]);

  /**
   * The server is authoritative. Its numbers replace the client's the moment a save returns,
   * and on a posted document nothing else is ever shown.
   */
  const showServerTotals = serverEntry !== null && (isPosted || !dirty);
  const totals = showServerTotals && serverEntry !== null ? serverEntry : clientTotals;

  const totalQty = filledLines.reduce((sum, line) => sum + num(line.qty), 0);

  /* -------------------------------------------------------------- exceptions */

  const exceptions: PurchaseExceptionDto[] = useMemo(() => {
    if (preview.data !== undefined) {
      return [...preview.data.blocking, ...preview.data.overridable, ...preview.data.advisory];
    }
    return serverEntry?.exceptions ?? [];
  }, [preview.data, serverEntry]);

  const blocking = useMemo(() => blockingExceptions(exceptions), [exceptions]);
  const blockedReason =
    blocking.length === 0
      ? null
      : `BLOCKED: ${blocking[0]?.code ?? ''} — ${blocking[0]?.message ?? ''}`;

  /** Silence is not consent: an overridable exception counts only when its box is ticked. */
  const unacceptedOverridable = useMemo(
    () =>
      openExceptions(exceptions).filter(
        (exception) =>
          exception.severity === ExceptionSeverity.OVERRIDABLE &&
          !acceptedCodes.includes(exception.code),
      ),
    [acceptedCodes, exceptions],
  );

  const toggleAccept = useCallback((code: PurchaseExceptionCode, accepted: boolean) => {
    setAcceptedCodes((codes) =>
      accepted ? [...new Set([...codes, code])] : codes.filter((existing) => existing !== code),
    );
  }, []);

  /* ------------------------------------------------------------------- saving */

  const buildLines = useCallback((): PurchaseEntryLineInput[] => {
    return filledLines.map((line, index) => {
      const destination =
        line.dest.trim() === ''
          ? null
          : (locationByCode.get(line.dest.trim().toUpperCase())?.id ?? null);
      return {
        id: line.lineId ?? undefined,
        productId: line.productId,
        description: line.productId === null ? line.name.trim() : null,
        quantity: num(line.qty),
        rate: num(line.rate),
        discountPercent: num(line.disc),
        batchNumber: line.batch.trim() === '' ? null : line.batch.trim().toUpperCase(),
        expiryDate: parseExpiry(line.expiry),
        receivedQuantity: line.recd.trim() === '' ? num(line.qty) : num(line.recd),
        acceptedQuantity:
          line.accpt.trim() === ''
            ? line.recd.trim() === ''
              ? num(line.qty)
              : num(line.recd)
            : num(line.accpt),
        rejectedQuantity: num(line.rej),
        destinationLocationId: destination,
        sortOrder: index,
      };
    });
  }, [filledLines, locationByCode]);

  const persist = useCallback(async (): Promise<PurchaseEntryDto | null> => {
    setError(null);
    if (supplierId === null) {
      setError('SELECT A SUPPLIER — F4');
      partyRef.current?.focus();
      return null;
    }
    if (filledLines.length === 0) {
      setError('NO ITEMS ENTERED');
      return null;
    }
    const header = {
      supplierId,
      purchaseType,
      businessDate: isoToday(),
      supplierInvoiceNumber: billNo.trim() === '' ? null : billNo.trim(),
      supplierInvoiceDate: parseDmy(billDate),
      dueDate: paymentMethod === PurchasePaymentMethod.CREDIT ? parseDmy(dueDate) : null,
      paymentMethod,
      receivingLocationId: locationId === '' ? null : locationId,
      notes: remark.trim() === '' ? null : remark.trim(),
      lines: buildLines(),
    };
    try {
      const saved =
        serverEntry === null
          ? await createEntry.mutateAsync(header)
          : await updateEntry.mutateAsync({
            entryId: serverEntry.id,
            body: { ...header, expectedRevision: serverEntry.revision },
          });
      /*
       * Take the server's line identity and its figures without rebuilding the grid: the
       * operator may already be typing the next line, and a wholesale re-hydrate would eat
       * those keystrokes. The refetch that follows the invalidation is stamped as seen.
       */
      hydrated.current = `${saved.id}:${saved.revision}`;
      const savedLines = (saved.lines ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
      setLines((rows) => {
        let index = 0;
        return rows.map((row) => {
          if (!isFilled(row)) return row;
          const match = savedLines[index];
          index += 1;
          if (match === undefined) return row;
          return {
            ...row,
            lineId: match.id,
            taxRate: match.taxRate,
            serverAmount: match.lineTotal,
            lastPurchaseRate: match.lastPurchaseRate ?? row.lastPurchaseRate,
          };
        });
      });
      setServerEntry(saved);
      setDirty(false);
      if (entryId !== saved.id) setParams({ entryId: saved.id }, { replace: true });
      return saved;
    } catch (err) {
      setError(readError(err).message.toUpperCase());
      return null;
    }
  }, [
    billDate,
    billNo,
    buildLines,
    createEntry,
    dueDate,
    entryId,
    filledLines.length,
    locationId,
    paymentMethod,
    purchaseType,
    remark,
    serverEntry,
    setParams,
    supplierId,
    updateEntry,
  ]);

  const saveDraft = useCallback(async () => {
    await persist();
  }, [persist]);

  const saveReady = useCallback(async () => {
    const saved = await persist();
    if (saved === null) return;
    try {
      const ready = await markReady.mutateAsync(saved.id);
      hydrated.current = `${ready.id}:${ready.revision}`;
      setServerEntry(ready);
      setDirty(false);
    } catch (err) {
      setError(readError(err).message.toUpperCase());
    }
  }, [markReady, persist]);

  const openPayment = useCallback(async () => {
    if (!canPost) {
      setError('YOU MAY NOT POST A PURCHASE');
      return;
    }
    if (blockedReason !== null) {
      setError(blockedReason.toUpperCase());
      return;
    }
    if (unacceptedOverridable.length > 0) {
      setError('ACCEPT THE OVERRIDABLE EXCEPTIONS FIRST');
      return;
    }
    const saved = serverEntry !== null && !dirty ? serverEntry : await persist();
    if (saved === null) return;
    setPayOpen(true);
  }, [blockedReason, canPost, dirty, persist, serverEntry, unacceptedOverridable.length]);

  /* --------------------------------------------------------------- navigation */

  const isCellDisabled = useCallback(
    (line: EntryLine, col: ColumnId): boolean => {
      if (!canEdit) return true;
      if (col === 'batch') return !line.isBatchTracked;
      if (col === 'expiry') return !line.isExpiryTracked;
      return false;
    },
    [canEdit],
  );

  /** The next focusable column to the given side, skipping cells this product cannot use. */
  const stepColumn = useCallback(
    (line: EntryLine, col: ColumnId, delta: number): ColumnId | null => {
      let index = COLUMNS.indexOf(col) + delta;
      while (index >= 0 && index < COLUMNS.length) {
        const candidate = COLUMNS[index];
        if (candidate !== undefined && !isCellDisabled(line, candidate)) return candidate;
        index += delta;
      }
      return null;
    },
    [isCellDisabled],
  );

  const advance = useCallback(
    (rowIndex: number, col: ColumnId) => {
      const line = lines[rowIndex];
      if (line === undefined) return;
      const next = stepColumn(line, col, 1);
      if (next !== null) {
        setFocusTarget({ row: rowIndex, col: next });
        return;
      }
      if (!isFilled(line)) {
        setFocusTarget({ row: rowIndex, col: 'product' });
        return;
      }
      setLines((rows) => (rowIndex === rows.length - 1 ? [...rows, blankLine()] : rows));
      setFocusTarget({ row: rowIndex + 1, col: 'product' });
    },
    [lines, stepColumn],
  );

  const handleCellKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, col: ColumnId) => {
      const input = event.currentTarget;
      if (event.key === 'Enter') {
        event.preventDefault();
        advance(rowIndex, col);
        return;
      }
      if (event.key === 'ArrowDown') {
        if (rowIndex + 1 < lines.length) {
          event.preventDefault();
          setFocusTarget({ row: rowIndex + 1, col });
        }
        return;
      }
      if (event.key === 'ArrowUp') {
        if (rowIndex > 0) {
          event.preventDefault();
          setFocusTarget({ row: rowIndex - 1, col });
        }
        return;
      }
      if (event.key === 'ArrowRight' && (input.selectionStart ?? 0) >= input.value.length) {
        const line = lines[rowIndex];
        const next = line === undefined ? null : stepColumn(line, col, 1);
        if (next !== null) {
          event.preventDefault();
          setFocusTarget({ row: rowIndex, col: next });
        }
        return;
      }
      if (event.key === 'ArrowLeft' && (input.selectionEnd ?? 0) === 0) {
        const line = lines[rowIndex];
        const previous = line === undefined ? null : stepColumn(line, col, -1);
        if (previous !== null) {
          event.preventDefault();
          setFocusTarget({ row: rowIndex, col: previous });
        }
        return;
      }
      if (event.key === 'Delete' && event.ctrlKey) {
        const line = lines[rowIndex];
        if (line !== undefined && isFilled(line)) {
          event.preventDefault();
          removeLine(line.key);
          setFocusTarget({ row: Math.max(0, rowIndex - 1), col: 'product' });
        }
      }
    },
    [advance, lines, removeLine, stepColumn],
  );

  const handleItemKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, line: EntryLine) => {
      const open = pickerOpen && pickerKey === line.key;
      if (open && event.key === 'ArrowDown') {
        event.preventDefault();
        setPickIndex((index) => Math.min(index + 1, suggestions.length - 1));
        return;
      }
      if (open && event.key === 'ArrowUp') {
        event.preventDefault();
        setPickIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === 'Escape') {
        setPickerKey(null);
        return;
      }
      if (event.key === 'Enter' && open) {
        const picked = suggestions[pickIndex];
        if (picked !== undefined) {
          event.preventDefault();
          applyProduct(line.key, picked);
          setFocusTarget({ row: rowIndex, col: 'qty' });
          return;
        }
      }
      handleCellKey(event, rowIndex, 'product');
    },
    [applyProduct, handleCellKey, pickIndex, pickerKey, pickerOpen, suggestions],
  );

  const openPicker = useCallback(() => {
    const row = lines[cursor.row];
    if (row === undefined) return;
    forcePicker.current = true;
    setPickerKey(row.key);
    setPickIndex(0);
    setFocusTarget({ row: cursor.row, col: 'product' });
  }, [cursor.row, lines]);

  const deleteCurrentLine = useCallback(() => {
    const row = lines[cursor.row];
    if (row === undefined || !isFilled(row)) return;
    removeLine(row.key);
    setFocusTarget({ row: Math.max(0, cursor.row - 1), col: 'product' });
  }, [cursor.row, lines, removeLine]);

  /* ------------------------------------------------------------ the F-key map */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (payOpen) return;
      if (event.key === 'F2' && canEdit) {
        event.preventDefault();
        openPicker();
        return;
      }
      if (event.key === 'F4' && canEdit) {
        event.preventDefault();
        setPartyPickerOpen(true);
        partyRef.current?.focus();
        partyRef.current?.select();
        return;
      }
      if (event.key === 'F9' && canEdit && !busy) {
        event.preventDefault();
        void saveDraft();
        return;
      }
      if (event.key === 'F10' && canEdit && !busy) {
        event.preventDefault();
        void saveReady();
        return;
      }
      if (event.key === 'F12' && canPost && !busy) {
        event.preventDefault();
        void openPayment();
        return;
      }
      if (event.key === 'Escape') {
        if (pickerKey !== null) {
          setPickerKey(null);
          return;
        }
        if (partyPickerOpen) {
          setPartyPickerOpen(false);
          return;
        }
        navigate('/purchase/register');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    busy,
    canEdit,
    canPost,
    navigate,
    openPayment,
    openPicker,
    partyPickerOpen,
    payOpen,
    pickerKey,
    saveDraft,
    saveReady,
  ]);

  /* -------------------------------------------------------------- small utils */

  const jump =
    (target: React.RefObject<HTMLElement>) =>
      (event: React.KeyboardEvent): void => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        target.current?.focus();
      };

  const registerCell = (key: string, col: ColumnId) => (element: HTMLInputElement | null) => {
    const id = `${key}:${col}`;
    if (element === null) cellRefs.current.delete(id);
    else cellRefs.current.set(id, element);
  };

  const textCell = (
    line: EntryLine,
    rowIndex: number,
    col: ColumnId,
    value: string,
    onChange: (next: string) => void,
    align: 'left' | 'right',
  ): JSX.Element => {
    const disabled = isCellDisabled(line, col);
    return (
      <input
        ref={registerCell(line.key, col)}
        value={value}
        autoComplete="off"
        spellCheck={false}
        tabIndex={disabled ? -1 : undefined}
        inputMode={align === 'right' ? 'decimal' : undefined}
        className={`${MARG_CELL} ${align === 'right' ? 'text-right tabular-nums' : ''} ${disabled ? 'bg-[#d2dad7]' : ''
          }`}
        disabled={disabled}
        onFocus={() => setCursor({ row: rowIndex, col })}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => handleCellKey(event, rowIndex, col)}
      />
    );
  };

  const currentLine = lines[cursor.row];
  const currentDestName =
    currentLine === undefined || currentLine.dest === ''
      ? ''
      : (locationByCode.get(currentLine.dest.toUpperCase())?.name.toUpperCase() ??
        currentLine.dest.toUpperCase());

  const loadError = entryId !== null && loaded.isError;

  /* ----------------------------------------------------------------- render */

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#dfe6e2] font-mono text-[13px] text-black">
      <div className="flex shrink-0 items-center gap-1 bg-[#3d6382] px-1.5 py-[2px] text-[11px] leading-[14px] text-white">
        <span className="font-bold">MARG ERP 9+</span>
        <span className="truncate">
          |Gold-99 User|Series E- {ddmmyyyy(today)}|
          {serverEntry === null ? 'NEW' : serverEntry.entryNumber}|
          {party.trim() === '' ? 'SUPPLIER' : party.toUpperCase()}|USER-
          {(user?.username ?? 'MARG').toUpperCase()}
        </span>
      </div>

      <div className="shrink-0 border-b border-[#9aa8a4] px-1.5 py-[1px] text-[11px] leading-[14px]">
        Marg
      </div>

      <div className="flex shrink-0 items-center justify-between bg-[#2e6f6a] px-1.5 py-[2px] text-white">
        <span className="font-bold tracking-[0.06em]">PURCHASE ENTRY</span>
        <span className="flex items-center gap-2">
          {locked && (
            <span className="bg-[#a80000] px-1 text-[11px] font-bold">{status}</span>
          )}
          <span className="text-[12px]">{dateBar(today)}</span>
          <span className="bg-black px-1.5 font-bold text-[#ff9c00] tabular-nums">{clock}</span>
        </span>
      </div>

      {/* ------------------------------------------------------- header fields */}
      <div className="grid shrink-0 grid-cols-[7rem_minmax(11rem,1fr)_6rem_10rem_6rem_9rem] items-center gap-x-2 gap-y-[3px] px-2 py-1.5">
        <span className={MARG_LABEL}>Party Name:</span>
        <span className="relative">
          <input
            ref={partyRef}
            value={party}
            autoComplete="off"
            spellCheck={false}
            placeholder={vendorsLoading ? 'LOADING SUPPLIERS…' : 'F4 for supplier list…'}
            className={MARG_FIELD}
            disabled={!canEdit}
            onChange={(event) => {
              setParty(event.target.value);
              setSupplierId(null);
              setPartyPickerOpen(true);
              setPartyIndex(0);
              setDirty(true);
            }}
            onFocus={() => setPartyPickerOpen(party.trim() !== '')}
            onBlur={() => setPartyPickerOpen(false)}
            onKeyDown={(event) => {
              if (partyPickerOpen && event.key === 'ArrowDown') {
                event.preventDefault();
                setPartyIndex((index) => Math.min(index + 1, partySuggestions.length - 1));
                return;
              }
              if (partyPickerOpen && event.key === 'ArrowUp') {
                event.preventDefault();
                setPartyIndex((index) => Math.max(index - 1, 0));
                return;
              }
              if (event.key === 'Escape') {
                setPartyPickerOpen(false);
                return;
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                const picked = partySuggestions[partyIndex];
                if (partyPickerOpen && picked !== undefined) {
                  applyVendor(picked);
                  billNoRef.current?.focus();
                  return;
                }
                billNoRef.current?.focus();
              }
            }}
          />
          {partyPickerOpen && partySuggestions.length > 0 && (
            <div
              className={`absolute top-full left-0 z-40 max-h-[14rem] w-[30rem] overflow-auto bg-[#e8ede9] ${MARG_BEVEL_OUT} shadow-[3px_3px_0_rgba(0,0,0,0.35)]`}
            >
              <div
                className={`sticky top-0 flex justify-between border-b border-[#7d9490] bg-[#dfe6e2] px-1.5 py-[1px] font-bold ${MARG_LABEL}`}
              >
                <span>SUPPLIER</span>
                <span>OUTSTANDING</span>
              </div>
              {partySuggestions.map((vendor, index) => (
                <button
                  key={vendor.id}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-1.5 py-[1px] text-left uppercase ${index === partyIndex ? 'bg-[#2e6f6a] text-white' : 'text-black'
                    }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setPartyIndex(index)}
                  onClick={() => {
                    applyVendor(vendor);
                    billNoRef.current?.focus();
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {vendor.code} · {vendor.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {margAmount(vendor.outstanding ?? vendor.accountBalance)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </span>

        <span className={MARG_LABEL}>Bill No:</span>
        <input
          ref={billNoRef}
          value={billNo}
          autoComplete="off"
          className={MARG_FIELD}
          disabled={!canEdit}
          onChange={(event) => {
            setBillNo(event.target.value);
            setDirty(true);
          }}
          onKeyDown={jump(billDateRef)}
        />

        <span className={MARG_LABEL}>Bill Date:</span>
        <input
          ref={billDateRef}
          value={billDate}
          autoComplete="off"
          placeholder="DD-MM-YYYY"
          className={`${MARG_FIELD} tabular-nums`}
          disabled={!canEdit}
          onChange={(event) => {
            setBillDate(event.target.value);
            setDirty(true);
          }}
          onKeyDown={jump(typeRef)}
        />

        <span className={MARG_LABEL}>Type :</span>
        <select
          ref={typeRef}
          value={purchaseType}
          className={`${MARG_FIELD} cursor-pointer`}
          disabled={!canEdit}
          onChange={(event) => {
            const next = event.target.value as PurchaseType;
            setPurchaseType(next);
            writePref(TYPE_PREF, next);
            setDirty(true);
          }}
          onKeyDown={jump(paymentRef)}
        >
          {PURCHASE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <span className={MARG_LABEL}>Payment:</span>
        <select
          ref={paymentRef}
          value={paymentMethod}
          className={`${MARG_FIELD} cursor-pointer`}
          disabled={!canEdit}
          onChange={(event) => {
            const next = event.target.value as PurchasePaymentMethod;
            setPaymentMethod(next);
            writePref(PAY_PREF, next);
            setDirty(true);
          }}
          onKeyDown={jump(
            paymentMethod === PurchasePaymentMethod.CREDIT ? dueDateRef : locationRef,
          )}
        >
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {method}
            </option>
          ))}
        </select>

        <span className={MARG_LABEL}>Due Date:</span>
        <input
          ref={dueDateRef}
          value={dueDate}
          autoComplete="off"
          placeholder={paymentMethod === PurchasePaymentMethod.CREDIT ? 'DD-MM-YYYY' : '—'}
          className={`${MARG_FIELD} tabular-nums`}
          disabled={!canEdit || paymentMethod !== PurchasePaymentMethod.CREDIT}
          onChange={(event) => {
            setDueDate(event.target.value);
            setDirty(true);
          }}
          onKeyDown={jump(locationRef)}
        />

        <span className={MARG_LABEL}>Location:</span>
        <select
          ref={locationRef}
          value={locationId}
          className={`${MARG_FIELD} cursor-pointer`}
          disabled={!canEdit}
          onChange={(event) => {
            setLocationId(event.target.value);
            writePref(LOCATION_PREF, event.target.value);
            setDirty(true);
          }}
          onKeyDown={jump(remarkRef)}
        >
          <option value="">-- SELECT --</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} · {location.name.toUpperCase()}
            </option>
          ))}
        </select>

        <span className={MARG_LABEL}>Remark :</span>
        <input
          ref={remarkRef}
          value={remark}
          autoComplete="off"
          className={`${MARG_FIELD} col-span-3`}
          disabled={!canEdit}
          onChange={(event) => {
            setRemark(event.target.value);
            setDirty(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setCursor({ row: 0, col: 'product' });
            setFocusTarget({ row: 0, col: 'product' });
          }}
        />
      </div>

      {/* ----------------------------------------------------------- line grid */}
      <div className="min-h-0 flex-1 overflow-auto border-y border-[#7d9490] bg-[#e8ede9]">
        <table className="w-full min-w-[80rem] table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-[5rem]" />
            <col className="w-[4rem]" />
            <col className="w-[6rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[4rem]" />
            <col className="w-[7rem]" />
            <col className="w-[6rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[4.5rem]" />
            <col className="w-[5rem]" />
            <col className="w-[8rem]" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-[#dfe6e2]">
            <tr
              className={`${MARG_LABEL} [&>th]:border-y [&>th]:border-[#7d9490] [&>th]:px-1 [&>th]:py-[2px] [&>th]:font-bold [&>th]:tracking-[0.04em]`}
            >
              <th className="text-left">PRODUCT</th>
              <th className="text-right">QTY</th>
              <th className="text-left">UNIT</th>
              <th className="text-right">RATE</th>
              <th className="text-right">DISC%</th>
              <th className="text-right">GST%</th>
              <th className="text-left">BATCH</th>
              <th className="text-left">EXPIRY</th>
              <th className="text-right">RECD</th>
              <th className="text-right">ACCPT</th>
              <th className="text-right">REJ</th>
              <th className="text-left">DEST</th>
              <th className="text-right">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, rowIndex) => (
              <tr
                key={line.key}
                className={`[&>td]:p-0 ${cursor.row === rowIndex ? 'bg-[#cfe0dc]' : ''}`}
              >
                <td className="relative">
                  <input
                    ref={registerCell(line.key, 'product')}
                    value={line.name}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      rowIndex === 0
                        ? productsLoading
                          ? 'Loading products…'
                          : 'Type product name, F2 for list…'
                        : ''
                    }
                    className={MARG_CELL}
                    disabled={!canEdit}
                    onFocus={() => {
                      setCursor({ row: rowIndex, col: 'product' });
                      const forced = forcePicker.current;
                      forcePicker.current = false;
                      setPickerKey(forced || line.name.trim() !== '' ? line.key : null);
                      setPickIndex(0);
                    }}
                    onBlur={() => setPickerKey((key) => (key === line.key ? null : key))}
                    onChange={(event) => {
                      updateLine(line.key, {
                        name: event.target.value,
                        productId: null,
                        taxRate: null,
                        lastPurchaseRate: null,
                        serverAmount: null,
                      });
                      setPickerKey(line.key);
                      setPickIndex(0);
                    }}
                    onKeyDown={(event) => handleItemKey(event, rowIndex, line)}
                  />
                  {pickerOpen && pickerKey === line.key && (
                    <div
                      className={`absolute top-full left-1 z-30 max-h-[14rem] w-[38rem] overflow-auto bg-[#e8ede9] ${MARG_BEVEL_OUT} shadow-[3px_3px_0_rgba(0,0,0,0.35)]`}
                    >
                      <div
                        className={`sticky top-0 grid grid-cols-[1fr_5rem_6rem_6rem] gap-2 border-b border-[#7d9490] bg-[#dfe6e2] px-1.5 py-[1px] font-bold ${MARG_LABEL}`}
                      >
                        <span>PRODUCT</span>
                        <span className="text-right">STOCK</span>
                        <span className="text-right">LAST RATE</span>
                        <span className="text-right">UNIT</span>
                      </div>
                      {suggestions.map((product, index) => (
                        <button
                          key={product.id}
                          type="button"
                          ref={(element) => {
                            if (element === null) pickRefs.current.delete(index);
                            else pickRefs.current.set(index, element);
                          }}
                          className={`grid w-full grid-cols-[1fr_5rem_6rem_6rem] gap-2 px-1.5 py-[1px] text-left uppercase ${index === pickIndex ? 'bg-[#2e6f6a] text-white' : 'text-black'
                            }`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setPickIndex(index)}
                          onClick={() => {
                            applyProduct(line.key, product);
                            setFocusTarget({ row: rowIndex, col: 'qty' });
                          }}
                        >
                          <span className="min-w-0 truncate">{product.name}</span>
                          <span className="text-right tabular-nums">
                            {product.stockOnHand === undefined
                              ? ''
                              : margAmount(product.stockOnHand)}
                          </span>
                          <span className="text-right tabular-nums">
                            {product.lastPurchaseRate === null
                              ? ''
                              : margAmount(product.lastPurchaseRate)}
                          </span>
                          <span className="text-right">
                            {product.stockUomCode ?? product.unit}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  {textCell(line, rowIndex, 'qty', line.qty, (v) => setQty(line.key, v), 'right')}
                </td>
                <td className="px-1 uppercase">{line.unit}</td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'rate',
                    line.rate,
                    (v) => updateLine(line.key, { rate: v }),
                    'right',
                  )}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'disc',
                    line.disc,
                    (v) => updateLine(line.key, { disc: v }),
                    'right',
                  )}
                </td>
                <td className="px-1 text-right tabular-nums">
                  {line.taxRate === null ? '' : line.taxRate.toFixed(2)}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'batch',
                    line.batch,
                    (v) => updateLine(line.key, { batch: v }),
                    'left',
                  )}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'expiry',
                    line.expiry,
                    (v) => updateLine(line.key, { expiry: v }),
                    'left',
                  )}
                </td>
                <td>
                  {textCell(line, rowIndex, 'recd', line.recd, (v) => setRecd(line.key, v), 'right')}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'accpt',
                    line.accpt,
                    (v) => setAccpt(line.key, v),
                    'right',
                  )}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'rej',
                    line.rej,
                    (v) => updateLine(line.key, { rej: v, rejTouched: true }),
                    'right',
                  )}
                </td>
                <td>
                  {textCell(
                    line,
                    rowIndex,
                    'dest',
                    line.dest,
                    (v) => updateLine(line.key, { dest: v.toUpperCase(), destTouched: true }),
                    'left',
                  )}
                </td>
                <td className="px-1 text-right font-bold tabular-nums">
                  {!isFilled(line)
                    ? ''
                    : margAmount(
                      showServerTotals && line.serverAmount !== null
                        ? line.serverAmount
                        : lineTotal(line),
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------------- totals */}
      <div className="grid shrink-0 grid-cols-1 gap-2 px-2 py-1.5 md:grid-cols-[1fr_14rem_19rem]">
        <div className={`bg-[#d6e3ec] ${MARG_BEVEL_OUT} px-2 py-1`}>
          <div className="flex gap-2">
            <span className={`w-[5.5rem] shrink-0 ${MARG_LABEL}`}>Item :</span>
            <span className="min-w-0 flex-1 truncate font-bold uppercase">
              {currentLine?.name ?? ''}
            </span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[5.5rem] shrink-0 ${MARG_LABEL}`}>Last Rate:</span>
            <span className="w-[7rem] font-bold tabular-nums">
              {currentLine?.lastPurchaseRate == null
                ? ''
                : margAmount(currentLine.lastPurchaseRate)}
            </span>
            <span className={MARG_LABEL}>Stock:</span>
            <span className="font-bold tabular-nums">
              {currentLine?.stockOnHand == null ? '' : margAmount(currentLine.stockOnHand)}
            </span>
            <span className="font-bold uppercase">{currentLine?.unit ?? ''}</span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[5.5rem] shrink-0 ${MARG_LABEL}`}>Batch :</span>
            <span className="w-[7rem] font-bold uppercase">{currentLine?.batch ?? ''}</span>
            <span className={MARG_LABEL}>Expiry:</span>
            <span className="font-bold tabular-nums">{currentLine?.expiry ?? ''}</span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[5.5rem] shrink-0 ${MARG_LABEL}`}>Dest :</span>
            <span className="min-w-0 flex-1 truncate font-bold uppercase">{currentDestName}</span>
          </div>
        </div>

        <div className="flex flex-col">
          <Figure label="Taxable" value={margAmount(totals.taxableAmount)} />
          <Figure label="CGST" value={margAmount(totals.cgstAmount)} />
          <Figure label="SGST" value={margAmount(totals.sgstAmount)} />
          <Figure label="IGST" value={margAmount(totals.igstAmount)} />
          <Figure label="CESS" value={margAmount(totals.cessAmount)} />
        </div>

        <div className="flex flex-col border-l border-[#7d9490] pl-2">
          <Figure label="VALUE OF GOODS" value={margAmount(totals.subtotalAmount)} />
          <Figure label="DISCOUNT" value={margAmount(totals.discountAmount)} />
          <Figure label="OTHER CHG" value={margAmount(totals.otherCharges)} />
          <Figure label="ROUND OFF" value={margAmount(totals.roundOffAmount)} />
          <div className="flex items-baseline justify-between gap-2 border-y border-[#7d9490]">
            <span className={`font-bold ${MARG_LABEL}`}>GRAND TOTAL :</span>
            <span className="text-[15px] font-bold tabular-nums">
              {margAmount(totals.totalAmount)}
            </span>
          </div>
          <Figure label="PAID" value={margAmount(totals.paidAmount)} />
          <Figure label="OUTSTANDING" value={margAmount(totals.outstandingAmount)} />
        </div>
      </div>

      {/* ---------------------------------------------------------- status bar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[#7d9490] px-2 text-[11px] leading-[15px]">
        <span className={MARG_LABEL}>
          Items:{filledLines.length} Qty:{margAmount(totalQty)} Disc:
          {margAmount(totals.discountAmount)}
          {showServerTotals ? ' · SERVER TOTALS' : ' · UNSAVED'}
        </span>
        {(error !== null || loadError) && (
          <span role="alert" className="bg-[#a80000] px-1 font-bold text-white">
            {error ?? 'ENTRY COULD NOT BE LOADED'}
          </span>
        )}
      </div>

      {serverEntry !== null && (
        <DocumentFlowPanel flow={flow.data} isLoading={flow.isLoading} error={flow.error} />
      )}

      <PurchaseExceptionStrip
        exceptions={exceptions}
        acceptedCodes={acceptedCodes}
        onToggleAccept={toggleAccept}
        canOverride={canPost}
      />

      {/* ---------------------------------------------------------- action bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t-2 border-[#9aa8a4] bg-[#dfe6e2] px-1 py-[2px]">
        <span aria-hidden className="px-1 text-[14px] leading-none text-[#a80000]">
          ◀
        </span>
        <button type="button" className={MARG_BTN} disabled={!canEdit} onClick={openPicker}>
          Item F2
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={!canEdit}
          onClick={() => {
            setPartyPickerOpen(true);
            partyRef.current?.focus();
          }}
        >
          Party F4
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={!canEdit}
          onClick={deleteCurrentLine}
        >
          Del Line
        </button>
        <button
          type="button"
          className={`${MARG_BTN} bg-[#2b5b84] font-bold text-white`}
          disabled={!canEdit || busy}
          onClick={() => void saveDraft()}
        >
          Pend F9
        </button>
        <button
          type="button"
          className={`${MARG_BTN} bg-[#a80000] font-bold text-white disabled:text-[#e0c0c0]`}
          disabled={!canEdit || busy}
          onClick={() => void saveReady()}
        >
          SAVE F10
        </button>
        <button
          type="button"
          className={MARG_BTN}
          title={blockedReason ?? undefined}
          disabled={!canPost || busy || isPosted || blockedReason !== null}
          onClick={() => void openPayment()}
        >
          Pay F12
        </button>
        {blockedReason !== null && (
          <span className="bg-[#a80000] px-1 text-[11px] leading-[15px] font-bold text-white uppercase">
            {blockedReason}
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          className={MARG_BTN}
          onClick={() => navigate('/purchase/register')}
        >
          Exit Esc
        </button>
      </div>

      {payOpen && serverEntry !== null && (
        <PurchaseMargPaymentModal
          entry={serverEntry}
          acceptedCodes={acceptedCodes}
          blockedReason={blockedReason}
          onClose={() => setPayOpen(false)}
          onPosted={(result) => {
            setPayOpen(false);
            setServerEntry(result.entry);
            setDirty(false);
          }}
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={MARG_LABEL}>{label === '' ? ' ' : `${label} :`}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
