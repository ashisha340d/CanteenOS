import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AvailabilityStatus,
  Capability,
  LIMITS,
  MasterStatus,
  PosDiscountType,
  PosOrderItemStatus,
  PosOrderStatus,
  PosOrderType,
  type PosOrderDetailDto,
  type PosOrderItemDto,
  type PosOrderItemInput,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
} from '@menuboard/shared';
import { ORDER_TYPE_LABEL } from './posFormat';
import { PosMargCheckoutModal } from './PosMargCheckoutModal';
import {
  MARG_BEVEL_OUT,
  MARG_BTN,
  MARG_CELL,
  MARG_FIELD,
  MARG_LABEL,
  margAmount,
  readPref,
  writePref,
} from './margChrome';
import { menusApi } from '../../api/menuMaster';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import {
  useCreatePosOrder,
  usePosOrder,
  useSetPosOrderStatus,
  useUpdatePosOrder,
} from '../../hooks/usePos';
import { useMenus } from '../../hooks/useMenuMaster';

interface CartLine {
  key: string;
  menuItemId: string | null;
  variantId: string | null;
  customItemName: string | null;
  name: string;
  variantName: string | null;
  unit: string;
  mrp: number | null;
  taxRate: number | null;
  qty: string;
  rate: string;
  disc: string;
  allowDecimalQuantity: boolean;
  notes: string | null;
}

interface Sellable {
  item: ResolvedMenuItemDto;
  variant: ResolvedMenuVariantDto | null;
}

const COLUMNS = ['item', 'qty', 'rate'] as const;

const TAX_RATE = 5;
type ColumnId = (typeof COLUMNS)[number];

const ORDER_TYPES: PosOrderType[] = [
  PosOrderType.TAKEAWAY,
  PosOrderType.DINE_IN,
  PosOrderType.DELIVERY,
  PosOrderType.QUICK_SALE,
];

const TYPE_PREF = 'pos-marg-type';
const MENU_PREF = 'pos-marg-menu';

const CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function isOrderType(value: string | null): value is PosOrderType {
  return value !== null && (ORDER_TYPES as string[]).includes(value);
}

function num(value: string): number {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function lineKey(): string {
  return `line-${crypto.randomUUID()}`;
}

function blankLine(): CartLine {
  return {
    key: lineKey(),
    menuItemId: null,
    variantId: null,
    customItemName: null,
    name: '',
    variantName: null,
    unit: 'NOS',
    mrp: null,
    taxRate: null,
    qty: '',
    rate: '',
    disc: '',
    allowDecimalQuantity: false,
    notes: null,
  };
}

function isFilled(line: CartLine): boolean {
  return line.name.trim() !== '';
}

function lineQty(line: CartLine): number {
  const raw = line.qty.trim();
  if (raw === '') return 1;
  const value = num(raw);
  if (value <= 0) return 0;
  return line.allowDecimalQuantity ? Math.round(value * 1000) / 1000 : Math.round(value);
}

function lineRate(line: CartLine): number {
  return Math.max(0, Math.round(num(line.rate) * 100) / 100);
}

function linePercent(line: CartLine): number {
  return Math.min(100, Math.max(0, num(line.disc)));
}

function lineGross(line: CartLine): number {
  return lineQty(line) * lineRate(line);
}

function lineDiscount(line: CartLine): number {
  return Math.round(((lineGross(line) * linePercent(line)) / 100) * 100) / 100;
}

function lineNet(line: CartLine): number {
  return lineGross(line) - lineDiscount(line);
}

function lineTaxable(line: CartLine): number {
  return Math.round((lineNet(line) / (1 + TAX_RATE / 100)) * 100) / 100;
}

function lineTax(line: CartLine): number {
  return Math.round((lineNet(line) - lineTaxable(line)) * 100) / 100;
}

function dateBar(when: Date): string {
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(when);
  return `${when.toLocaleDateString('en-GB').replace(/\//g, '-')}|${day}`;
}

export function PosMargEntryPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasCapability, user } = useAuth();
  const canOperate = hasCapability(Capability.POS_OPERATE);
  const canCheckout = hasCapability(Capability.POS_CHECKOUT);

  const orderId = params.get('orderId');
  const wantsCheckout = params.get('checkout') === '1';
  const urlType = params.get('type');

  const [menuCode, setMenuCode] = useState(() => readPref(MENU_PREF) ?? '');
  const [orderType, setOrderType] = useState<PosOrderType>(() => {
    if (isOrderType(urlType)) return urlType;
    const saved = readPref(TYPE_PREF);
    return isOrderType(saved) ? saved : PosOrderType.TAKEAWAY;
  });
  const [lines, setLines] = useState<CartLine[]>(() => [blankLine()]);
  const [billNo, setBillNo] = useState('');
  const [party, setParty] = useState('');
  const [address, setAddress] = useState('');
  const [remark, setRemark] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<PosOrderDetailDto | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const [pickIndex, setPickIndex] = useState(0);
  const [cursor, setCursor] = useState<{ row: number; col: ColumnId }>({ row: 0, col: 'item' });
  const [focusTarget, setFocusTarget] = useState<{ row: number; col: ColumnId } | null>(null);
  const [clock, setClock] = useState(() => CLOCK.format(new Date()));

  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const pickRefs = useRef(new Map<number, HTMLButtonElement>());
  const forcePicker = useRef(false);
  const typeRef = useRef<HTMLSelectElement>(null);
  const menuRef = useRef<HTMLSelectElement>(null);
  const partyRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const remarkRef = useRef<HTMLInputElement>(null);

  const { data: loadedOrder } = usePosOrder(orderId);
  const createOrder = useCreatePosOrder();
  const updateOrder = useUpdatePosOrder();
  const setStatus = useSetPosOrderStatus();
  const busy = createOrder.isPending || updateOrder.isPending || setStatus.isPending;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(CLOCK.format(new Date())), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const enter = (): void => {
      if (document.fullscreenElement !== null) return;
      void document.documentElement.requestFullscreen().catch(() => undefined);
    };
    enter();
    const onGesture = (): void => {
      enter();
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      if (document.fullscreenElement !== null) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const menuListQuery = useMemo(
    () => ({ status: MasterStatus.ACTIVE, page: 1, pageSize: 100 }),
    [],
  );
  const { data: menuPage } = useMenus(menuListQuery);
  const publishedMenus = useMemo(
    () => (menuPage?.items ?? []).filter((menu) => menu.publishedAt !== null),
    [menuPage],
  );
  const selectedMenu = publishedMenus.find((menu) => menu.code === menuCode) ?? null;
  const menuId = selectedMenu?.id ?? loadedOrder?.menuId ?? null;

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['menuTree', menuCode],
    queryFn: () => menusApi.tree(menuCode),
    enabled: menuCode !== '',
  });

  useEffect(() => {
    if (publishedMenus.length === 0) return;
    if (loadedOrder !== undefined && loadedOrder.menuId !== null && menuCode === '') {
      const own = publishedMenus.find((menu) => menu.id === loadedOrder.menuId);
      if (own !== undefined) setMenuCode(own.code);
      return;
    }
    if (publishedMenus.some((menu) => menu.code === menuCode)) return;
    const first = publishedMenus[0];
    if (first !== undefined) setMenuCode(first.code);
  }, [menuCode, publishedMenus, loadedOrder]);

  useEffect(() => {
    if (loadedOrder === undefined) return;
    setOrderType(loadedOrder.orderType);
    setBillNo(loadedOrder.orderNumber);
    setParty(loadedOrder.entityName ?? '');
    setAddress(loadedOrder.entityAddress ?? '');
    setRemark(loadedOrder.notes ?? '');
    setLines(
      loadedOrder.items
        .filter((item) => item.status === PosOrderItemStatus.ACTIVE)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map<CartLine>((item: PosOrderItemDto) => ({
          key: lineKey(),
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          customItemName: item.customItemName,
          name: item.itemName,
          variantName: item.variantName,
          unit: item.unit,
          mrp: item.unitPrice,
          taxRate: item.taxRate,
          qty: String(item.quantity),
          rate: String(item.unitPrice),
          disc:
            item.discountType === PosDiscountType.PERCENT && item.discountValue > 0
              ? String(item.discountValue)
              : '',
          allowDecimalQuantity: item.allowDecimalQuantity,
          notes: item.notes,
        })),
    );
  }, [loadedOrder]);

  useEffect(() => {
    setLines((rows) => {
      const last = rows[rows.length - 1];
      if (last !== undefined && !isFilled(last)) return rows;
      return [...rows, blankLine()];
    });
  }, [lines]);

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

  const allSellables = useMemo(() => {
    const list: Sellable[] = [];
    if (tree === undefined) return list;
    for (const category of tree.categories) {
      for (const item of category.items) {
        if (item.variants.length > 0) {
          for (const variant of item.variants) {
            if (variant.availability === AvailabilityStatus.AVAILABLE) list.push({ item, variant });
          }
        } else if (item.availability === AvailabilityStatus.AVAILABLE) {
          list.push({ item, variant: null });
        }
      }
    }
    return list;
  }, [tree]);

  const pickerRow = pickerKey === null ? null : (lines.find((row) => row.key === pickerKey) ?? null);

  const suggestions = useMemo(() => {
    if (pickerRow === null) return [];
    const q = pickerRow.name.trim().toLowerCase();
    const matches =
      q === ''
        ? allSellables
        : allSellables.filter(({ item, variant }) =>
            `${item.name} ${variant?.name ?? ''} ${item.unit}`.toLowerCase().includes(q),
          );
    return matches.slice(0, 60);
  }, [allSellables, pickerRow]);

  const pickerOpen = pickerKey !== null && suggestions.length > 0;

  const updateLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((rows) => rows.filter((row) => row.key !== key));
  }, []);

  const applyPick = useCallback(
    (key: string, { item, variant }: Sellable) => {
      const price = variant?.price ?? item.basePrice ?? 0;
      updateLine(key, {
        menuItemId: item.foodItemId,
        variantId: variant?.id ?? null,
        customItemName: null,
        name: variant !== null ? `${item.name} - ${variant.name}` : item.name,
        variantName: variant?.name ?? null,
        unit: variant?.unit ?? item.unit ?? 'NOS',
        mrp: price,
        rate: String(price),
        qty: '1',
        allowDecimalQuantity: variant?.allowDecimalQuantity ?? item.allowDecimalQuantity ?? false,
      });
      setPickerKey(null);
      setPickIndex(0);
    },
    [updateLine],
  );

  const filledLines = useMemo(() => lines.filter(isFilled), [lines]);
  const subtotal = useMemo(
    () => filledLines.reduce((sum, line) => sum + lineGross(line), 0),
    [filledLines],
  );
  const discountTotal = useMemo(
    () => filledLines.reduce((sum, line) => sum + lineDiscount(line), 0),
    [filledLines],
  );
  const taxTotal = useMemo(
    () => filledLines.reduce((sum, line) => sum + lineTax(line), 0),
    [filledLines],
  );
  const totalQty = useMemo(
    () => filledLines.reduce((sum, line) => sum + lineQty(line), 0),
    [filledLines],
  );
  const billAmount = subtotal - discountTotal;

  const itemsPayload = useCallback((): PosOrderItemInput[] => {
    return filledLines.map((line, index) => {
      const percent = linePercent(line);
      return {
        menuItemId: line.menuItemId,
        variantId: line.variantId,
        customItemName: line.menuItemId === null ? line.name.trim() : null,
        unitPrice: lineRate(line),
        quantity: lineQty(line),
        unit: line.unit,
        discountType: percent > 0 ? PosDiscountType.PERCENT : PosDiscountType.NONE,
        discountValue: percent,
        notes: line.notes,
        sortOrder: index,
      };
    });
  }, [filledLines]);

  const persist = useCallback(
    async (status: PosOrderStatus): Promise<PosOrderDetailDto | null> => {
      setError(null);
      if (filledLines.length === 0) {
        setError('NO ITEMS ENTERED');
        return null;
      }
      const quickSale = orderType === PosOrderType.QUICK_SALE;
      try {
        let result: PosOrderDetailDto;
        const header = {
          orderType,
          menuId,
          entityId: null,
          entityName: quickSale ? null : party.trim() || null,
          entityPhone: null,
          entityAddress: quickSale ? null : address.trim() || null,
          tableLabel: null,
          pax: 0,
          scheduledFor: null,
          notes: remark.trim() || null,
        };
        if (loadedOrder === undefined) {
          result = await createOrder.mutateAsync({ ...header, status, items: itemsPayload() });
        } else {
          result = await updateOrder.mutateAsync({
            id: loadedOrder.id,
            body: { ...header, items: itemsPayload(), expectedRevision: loadedOrder.revision },
          });
          if (result.status !== status) {
            result = await setStatus.mutateAsync({ id: result.id, body: { status } });
          }
        }
        return result;
      } catch (err) {
        setError(readError(err).message.toUpperCase());
        return null;
      }
    },
    [
      address,
      createOrder,
      filledLines.length,
      itemsPayload,
      loadedOrder,
      menuId,
      orderType,
      party,
      remark,
      setStatus,
      updateOrder,
    ],
  );

  const handleCheckout = useCallback(async () => {
    if (!canCheckout) return;
    if (loadedOrder !== undefined && loadedOrder.status === PosOrderStatus.OPEN) {
      setCheckoutOrder(loadedOrder);
      return;
    }
    const placed = await persist(PosOrderStatus.OPEN);
    if (placed !== null) setCheckoutOrder(placed);
  }, [canCheckout, loadedOrder, persist]);

  const handleSave = useCallback(async () => {
    await persist(PosOrderStatus.DRAFT);
  }, [persist]);

  const resetBill = useCallback(() => {
    setLines([blankLine()]);
    setBillNo('');
    setParty('');
    setAddress('');
    setRemark('');
    setError(null);
    setPickerKey(null);
    setCursor({ row: 0, col: 'item' });
    setFocusTarget({ row: 0, col: 'item' });
  }, []);

  const handlePlace = useCallback(async () => {
    const placed = await persist(PosOrderStatus.OPEN);
    if (placed !== null) navigate(`/pos/marg?orderId=${placed.id}`, { replace: true });
  }, [persist, navigate]);

  useEffect(() => {
    if (!wantsCheckout || loadedOrder === undefined || !canCheckout) return;
    setCheckoutOrder(loadedOrder);
  }, [wantsCheckout, loadedOrder, canCheckout]);

  const advance = useCallback(
    (rowIndex: number, col: ColumnId) => {
      const next = COLUMNS[COLUMNS.indexOf(col) + 1];
      if (next !== undefined) {
        setFocusTarget({ row: rowIndex, col: next });
        return;
      }
      const line = lines[rowIndex];
      if (line === undefined || !isFilled(line)) {
        setFocusTarget({ row: rowIndex, col: 'item' });
        return;
      }
      setLines((rows) => (rowIndex === rows.length - 1 ? [...rows, blankLine()] : rows));
      setFocusTarget({ row: rowIndex + 1, col: 'item' });
    },
    [lines],
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
        const next = COLUMNS[COLUMNS.indexOf(col) + 1];
        if (next !== undefined) {
          event.preventDefault();
          setFocusTarget({ row: rowIndex, col: next });
        }
        return;
      }
      if (event.key === 'ArrowLeft' && (input.selectionEnd ?? 0) === 0) {
        const previous = COLUMNS[COLUMNS.indexOf(col) - 1];
        if (previous !== undefined) {
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
          setFocusTarget({ row: Math.max(0, rowIndex - 1), col: 'item' });
        }
      }
    },
    [advance, lines, removeLine],
  );

  const handleItemKey = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, line: CartLine) => {
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
      if (event.key === 'Enter') {
        if (open) {
          const picked = suggestions[pickIndex];
          if (picked !== undefined) {
            event.preventDefault();
            applyPick(line.key, picked);
            setFocusTarget({ row: rowIndex, col: 'qty' });
            return;
          }
        }
        if (!isFilled(line) && rowIndex === lines.length - 1 && filledLines.length > 0) {
          event.preventDefault();
          void handleCheckout();
          return;
        }
      }
      handleCellKey(event, rowIndex, 'item');
    },
    [
      applyPick,
      filledLines.length,
      handleCellKey,
      handleCheckout,
      lines.length,
      pickIndex,
      pickerKey,
      pickerOpen,
      suggestions,
    ],
  );

  const openPicker = useCallback(() => {
    const row = lines[cursor.row];
    if (row === undefined) return;
    forcePicker.current = true;
    setPickerKey(row.key);
    setPickIndex(0);
    setFocusTarget({ row: cursor.row, col: 'item' });
  }, [cursor.row, lines]);

  const deleteCurrentLine = useCallback(() => {
    const row = lines[cursor.row];
    if (row === undefined || !isFilled(row)) return;
    removeLine(row.key);
    setFocusTarget({ row: Math.max(0, cursor.row - 1), col: 'item' });
  }, [cursor.row, lines, removeLine]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (checkoutOrder !== null) return;
      if (event.key === 'F2' && canOperate) {
        event.preventDefault();
        openPicker();
        return;
      }
      if (event.key === 'F4' && canOperate) {
        event.preventDefault();
        partyRef.current?.focus();
        return;
      }
      if (event.key === 'F9' && canOperate && !busy) {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (event.key === 'F10' && canOperate && !busy) {
        event.preventDefault();
        void handlePlace();
        return;
      }
      if (event.key === 'F12' && canCheckout && !busy) {
        event.preventDefault();
        void handleCheckout();
        return;
      }
      if (event.key === 'Escape' && pickerKey === null) navigate('/pos');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    busy,
    canCheckout,
    canOperate,
    checkoutOrder,
    handleCheckout,
    handlePlace,
    handleSave,
    navigate,
    openPicker,
    pickerKey,
  ]);

  const chooseType = (next: PosOrderType): void => {
    setOrderType(next);
    writePref(TYPE_PREF, next);
  };

  const chooseMenu = (next: string): void => {
    setMenuCode(next);
    writePref(MENU_PREF, next);
  };

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

  const numericCell = (
    line: CartLine,
    rowIndex: number,
    col: Extract<ColumnId, 'qty' | 'rate'>,
  ): JSX.Element => (
    <input
      ref={registerCell(line.key, col)}
      value={line[col]}
      inputMode="decimal"
      autoComplete="off"
      className={`${MARG_CELL} text-right tabular-nums`}
      disabled={!canOperate}
      onFocus={() => setCursor({ row: rowIndex, col })}
      onChange={(event) => updateLine(line.key, { [col]: event.target.value })}
      onKeyDown={(event) => handleCellKey(event, rowIndex, col)}
    />
  );

  const currentLine = lines[cursor.row];

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#dfe6e2] font-mono text-[13px] text-black">
      <div className="flex shrink-0 items-center gap-1 bg-[#3d6382] px-1.5 py-[2px] text-[11px] leading-[14px] text-white">
        <span className="font-bold">MARG ERP 9+</span>
        <span className="truncate">
          |Gold-99 User|Series E- {today.toLocaleDateString('en-GB').replace(/\//g, '-')}|
          {billNo === '' ? 'NEW' : billNo}|{selectedMenu?.name.toUpperCase() ?? 'MENU'}|USER-
          {(user?.username ?? 'MARG').toUpperCase()}
        </span>
      </div>

      <div className="shrink-0 border-b border-[#9aa8a4] px-1.5 py-[1px] text-[11px] leading-[14px]">
        Marg
      </div>

      <div className="flex shrink-0 items-center justify-between bg-[#2e6f6a] px-1.5 py-[2px] text-white">
        <span className="font-bold tracking-[0.06em]">SALE ENTRY</span>
        <span className="flex items-center gap-2">
          <span className="text-[12px]">{dateBar(today)}</span>
          <span className="bg-black px-1.5 font-bold text-[#ff9c00] tabular-nums">{clock}</span>
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-[7rem_minmax(10rem,1fr)_5rem_11rem_5rem_9rem] items-center gap-x-2 gap-y-[3px] px-2 py-1.5">
        <span className={MARG_LABEL}>Party Name:</span>
        <input
          ref={partyRef}
          value={party}
          autoComplete="off"
          placeholder="WALK-IN"
          className={MARG_FIELD}
          disabled={!canOperate || orderType === PosOrderType.QUICK_SALE}
          onChange={(event) => setParty(event.target.value)}
          onKeyDown={jump(addressRef)}
        />
        <span className={MARG_LABEL}>Bill:</span>
        <span className="font-bold tabular-nums">{billNo === '' ? 'NEW' : billNo}</span>
        <span className={MARG_LABEL}>Date :</span>
        <span className="font-bold tabular-nums">
          {today.toLocaleDateString('en-GB').replace(/\//g, '-')}
        </span>

        <span className={MARG_LABEL}>Type :</span>
        <select
          ref={typeRef}
          value={orderType}
          className={`${MARG_FIELD} cursor-pointer`}
          disabled={!canOperate}
          onChange={(event) => chooseType(event.target.value as PosOrderType)}
          onKeyDown={jump(menuRef)}
        >
          {ORDER_TYPES.map((type) => (
            <option key={type} value={type}>
              {ORDER_TYPE_LABEL[type].toUpperCase()}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>Menu :</span>
        <select
          ref={menuRef}
          value={menuCode}
          className={`${MARG_FIELD} cursor-pointer`}
          disabled={!canOperate}
          onChange={(event) => chooseMenu(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setCursor({ row: 0, col: 'item' });
            setFocusTarget({ row: 0, col: 'item' });
          }}
        >
          <option value="">-- SELECT --</option>
          {publishedMenus.map((menu) => (
            <option key={menu.id} value={menu.code}>
              {menu.name.toUpperCase()}
            </option>
          ))}
        </select>
        <span className={MARG_LABEL}>{treeLoading ? 'Loading' : 'Items'}</span>
        <span className="font-bold tabular-nums">{treeLoading ? '…' : allSellables.length}</span>

        <span className={MARG_LABEL}>Address :</span>
        <input
          ref={addressRef}
          value={address}
          autoComplete="off"
          className={MARG_FIELD}
          disabled={!canOperate || orderType === PosOrderType.QUICK_SALE}
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={jump(remarkRef)}
        />
        <span className={MARG_LABEL}>Remark :</span>
        <input
          ref={remarkRef}
          value={remark}
          autoComplete="off"
          maxLength={LIMITS.POS_ORDER_NOTES_MAX}
          className={`${MARG_FIELD} col-span-3`}
          disabled={!canOperate}
          onChange={(event) => setRemark(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setFocusTarget({ row: 0, col: 'item' });
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto border-y border-[#7d9490] bg-[#e8ede9]">
        <table className="w-full min-w-[58rem] table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-[6.5rem]" />
            <col className="w-[5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[5.5rem]" />
            <col className="w-[6rem]" />
            <col className="w-[8.5rem]" />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-[#dfe6e2]">
            <tr
              className={`${MARG_LABEL} [&>th]:border-y [&>th]:border-[#7d9490] [&>th]:px-1 [&>th]:py-[2px] [&>th]:font-bold [&>th]:tracking-[0.04em]`}
            >
              <th className="text-left">PRODUCT</th>
              <th className="text-right">M.R.P</th>
              <th className="text-right">QTY</th>
              <th className="text-right">RATE</th>
              <th className="text-right">DISC%</th>
              <th className="text-right">TAX</th>
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
                    ref={registerCell(line.key, 'item')}
                    value={line.name}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={rowIndex === 0 ? 'Type item name, F2 for list…' : ''}
                    className={MARG_CELL}
                    disabled={!canOperate}
                    onFocus={() => {
                      setCursor({ row: rowIndex, col: 'item' });
                      const forced = forcePicker.current;
                      forcePicker.current = false;
                      setPickerKey(forced || line.name.trim() !== '' ? line.key : null);
                      setPickIndex(0);
                    }}
                    onBlur={() => setPickerKey((key) => (key === line.key ? null : key))}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateLine(line.key, {
                        name: value,
                        menuItemId: null,
                        variantId: null,
                        variantName: null,
                        mrp: null,
                        taxRate: null,
                        customItemName: value.trim() === '' ? null : value,
                      });
                      setPickerKey(line.key);
                      setPickIndex(0);
                    }}
                    onKeyDown={(event) => handleItemKey(event, rowIndex, line)}
                  />
                  {pickerOpen && pickerKey === line.key && (
                    <div
                      className={`absolute top-full left-1 z-30 max-h-[14rem] w-[32rem] overflow-auto bg-[#e8ede9] ${MARG_BEVEL_OUT} shadow-[3px_3px_0_rgba(0,0,0,0.35)]`}
                    >
                      <div
                        className={`sticky top-0 flex justify-between border-b border-[#7d9490] bg-[#dfe6e2] px-1.5 py-[1px] font-bold ${MARG_LABEL}`}
                      >
                        <span>PRODUCT</span>
                        <span>RATE</span>
                      </div>
                      {suggestions.map((option, index) => {
                        const price = option.variant?.price ?? option.item.basePrice ?? 0;
                        const label =
                          option.variant !== null
                            ? `${option.item.name} - ${option.variant.name}`
                            : option.item.name;
                        return (
                          <button
                            key={`${option.item.foodItemId}-${option.variant?.id ?? 'base'}`}
                            type="button"
                            ref={(element) => {
                              if (element === null) pickRefs.current.delete(index);
                              else pickRefs.current.set(index, element);
                            }}
                            className={`flex w-full items-center justify-between gap-3 px-1.5 py-[1px] text-left uppercase ${
                              index === pickIndex ? 'bg-[#2e6f6a] text-white' : 'text-black'
                            }`}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setPickIndex(index)}
                            onClick={() => {
                              applyPick(line.key, option);
                              setFocusTarget({ row: rowIndex, col: 'qty' });
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            <span className="shrink-0 tabular-nums">{margAmount(price)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </td>
                <td className="px-1 text-right tabular-nums">
                  {line.mrp === null ? '' : margAmount(line.mrp)}
                </td>
                <td>{numericCell(line, rowIndex, 'qty')}</td>
                <td>{numericCell(line, rowIndex, 'rate')}</td>
                <td>
                  <input
                    value={line.disc}
                    inputMode="decimal"
                    autoComplete="off"
                    tabIndex={-1}
                    className={`${MARG_CELL} text-right tabular-nums`}
                    disabled={!canOperate}
                    onChange={(event) => updateLine(line.key, { disc: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault();
                    }}
                  />
                </td>
                <td className="px-1 text-right tabular-nums">
                  {isFilled(line) ? margAmount(lineTax(line)) : ''}
                </td>
                <td className="px-1 text-right font-bold tabular-nums">
                  {isFilled(line) ? margAmount(lineNet(line)) : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-2 px-2 py-1.5 md:grid-cols-[1fr_14rem_17rem]">
        <div className={`bg-[#d6e3ec] ${MARG_BEVEL_OUT} px-2 py-1`}>
          <div className="flex gap-2">
            <span className={`w-[4.5rem] ${MARG_LABEL}`}>Item :</span>
            <span className="min-w-0 flex-1 truncate font-bold uppercase">
              {currentLine?.name ?? ''}
            </span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[4.5rem] ${MARG_LABEL}`}>Disc% :</span>
            <span className="font-bold tabular-nums">{currentLine?.disc ?? ''}</span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[4.5rem] ${MARG_LABEL}`}>Expiry:</span>
            <span className="w-[6rem] font-bold" />
            <span className={MARG_LABEL}>Stock:</span>
            <span className="font-bold uppercase">{currentLine?.unit ?? ''}</span>
          </div>
          <div className="flex gap-2">
            <span className={`w-[4.5rem] ${MARG_LABEL}`}>Chall.:</span>
            <span className="w-[6rem] font-bold" />
            <span className={MARG_LABEL}>Date :</span>
            <span className="font-bold tabular-nums">
              {today.toLocaleDateString('en-GB').replace(/\//g, '-')}
            </span>
          </div>
        </div>

        <div className="flex flex-col">
          <Figure label="Amount" value={margAmount(billAmount)} />
          <Figure label="BGST" value={margAmount(taxTotal / 2)} />
          <Figure label="CGST" value={margAmount(taxTotal / 2)} />
          <Figure label="Balance" value={margAmount(loadedOrder?.balanceAmount ?? billAmount)} />
        </div>

        <div className="flex flex-col border-l border-[#7d9490] pl-2">
          <Figure label="VALUE OF GOODS" value={margAmount(subtotal)} />
          <Figure label="DISCOUNT" value={margAmount(discountTotal)} />
          <Figure label={`GST ${TAX_RATE}%`} value={margAmount(taxTotal)} />
          <Figure label="" value={margAmount(0)} />
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-[#7d9490] px-2 text-[11px] leading-[15px]">
        <span className={MARG_LABEL}>
          Items:{filledLines.length} Qty:{margAmount(totalQty)} Disc:{margAmount(discountTotal)}
        </span>
        {error !== null && (
          <span role="alert" className="bg-[#a80000] px-1 font-bold text-white">
            {error}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-t-2 border-[#9aa8a4] bg-[#dfe6e2] px-1 py-[2px]">
        <span aria-hidden className="px-1 text-[14px] leading-none text-[#a80000]">
          ◀
        </span>
        <button
          type="button"
          className={MARG_BTN}
          onClick={() => {
            resetBill();
            navigate(`/pos/marg?type=${orderType}`, { replace: true });
          }}
        >
          Sale
        </button>
        <button type="button" className={MARG_BTN} disabled={!canOperate} onClick={openPicker}>
          Item F2
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={!canOperate}
          onClick={() => partyRef.current?.focus()}
        >
          Party F4
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={!canOperate}
          onClick={deleteCurrentLine}
        >
          Del Line
        </button>
        <button
          type="button"
          className={`${MARG_BTN} bg-[#2b5b84] font-bold text-white`}
          disabled={!canOperate || busy}
          onClick={() => void handleSave()}
        >
          Pend Order F9
        </button>
        <button
          type="button"
          className={`${MARG_BTN} bg-[#a80000] font-bold text-white disabled:text-[#e0c0c0]`}
          disabled={!canOperate || busy}
          onClick={() => void handlePlace()}
        >
          SAVE F10
        </button>
        <button
          type="button"
          className={MARG_BTN}
          disabled={!canCheckout || busy}
          onClick={() => void handleCheckout()}
        >
          Cash. F12
        </button>
        <div className="flex-1" />
        <button type="button" className={MARG_BTN} onClick={() => navigate('/pos')}>
          Exit Esc
        </button>
      </div>

      {checkoutOrder !== null && (
        <PosMargCheckoutModal
          order={checkoutOrder}
          onClose={() => setCheckoutOrder(null)}
          onSettled={(settledOrder) => {
            setCheckoutOrder(null);
            resetBill();
            navigate(`/pos/marg?type=${settledOrder.orderType}`, { replace: true });
          }}
        />
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className={MARG_LABEL}>{label === '' ? ' ' : `${label} :`}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
