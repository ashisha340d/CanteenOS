import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AvailabilityStatus,
  canTransitionPosOrderStatus,
  Capability,
  LIMITS,
  MasterStatus,
  PosDiscountType,
  PosOrderItemStatus,
  PosOrderStatus,
  PosOrderType,
  PosPaymentMethod,
  TERMINAL_POS_ORDER_STATUSES,
  type EntityDto,
  type PosOrderDetailDto,
  type PosOrderItemInput,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
} from '@menuboard/shared';
import {
  ClockIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  Trash2Icon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';

import { EmptyState } from '@/components/ui/EmptyState';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, useDefaultLayout } from '@/components/ui/resizable';
import { CardGridSkeleton } from '@/components/ui/Skeletons';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { BackButton } from '../../components/BackButton';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { StatusChip } from '../../components/StatusChip';
import { menusApi, countersApi } from '../../api/menuMaster';
import { clearCdsLive, disconnectCdsLive, publishCdsLive } from '../../services/cdsLive';
import { useEntity } from '../../hooks/useEntities';
import { useMenus } from '../../hooks/useMenuMaster';
import {
  useCreatePosOrder,
  usePosOrder,
  useSetPosOrderStatus,
  useUpdatePosOrder,
} from '../../hooks/usePos';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import { toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

import { cn } from '@/lib/utils';
import { formatMoney, ORDER_TYPE_LABEL, scheduleLabel } from './posFormat';
import { PosCheckoutModal } from './PosCheckoutModal';
import { PosEntityPickerModal } from './PosEntityPickerModal';

interface CartLine {
  key: string;
  menuItemId: string | null;
  variantId: string | null;
  customItemName: string | null;
  name: string;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  allowDecimalQuantity: boolean;
  notes: string | null;
  discountType: PosDiscountType;
  discountValue: number;
}

const ALL_CATEGORIES = '__all__';

const ORDER_TYPES: PosOrderType[] = [
  PosOrderType.TAKEAWAY,
  PosOrderType.DINE_IN,
  PosOrderType.DELIVERY,
  PosOrderType.QUICK_SALE,
];

function isOrderType(value: string | null): value is PosOrderType {
  return value !== null && (ORDER_TYPES as string[]).includes(value);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** `datetime-local` speaks wall-clock time; the wire speaks ISO-8601 with an offset. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function lineGross(line: CartLine): number {
  return line.quantity * line.unitPrice;
}

function lineDiscount(line: CartLine): number {
  const gross = lineGross(line);
  if (line.discountType === PosDiscountType.PERCENT) {
    return Math.min(gross, (gross * line.discountValue) / 100);
  }
  if (line.discountType === PosDiscountType.AMOUNT) return Math.min(gross, line.discountValue);
  return 0;
}

function lineNet(line: CartLine): number {
  return lineGross(line) - lineDiscount(line);
}

/** Everything that moves the bill. Compared against the last server response to spot drift. */
function signatureOf(input: {
  orderType: PosOrderType;
  entityId: string | null;
  menuId: string | null;
  lines: CartLine[];
}): string {
  return JSON.stringify({
    orderType: input.orderType,
    entityId: input.entityId,
    menuId: input.menuId,
    lines: input.lines.map((line) => [
      line.menuItemId,
      line.variantId,
      line.customItemName,
      line.unitPrice,
      line.quantity,
      line.notes,
      line.discountType,
      line.discountValue,
    ]),
  });
}

function readStored<T>(key: string, fallback: T, parse?: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse !== undefined ? parse(raw) : (raw as T);
  } catch {
    return fallback;
  }
}

/**
 * The till.
 *
 * Three panes on a desktop — menu on the left, dishes in the middle, the ticket on the right —
 * because that is the order the work happens in and the operator's hand never crosses the screen
 * twice. On a phone the same three become two tabs plus a permanent total, since a third of a
 * narrow screen is not a pane, it is a stripe.
 */
export function PosEntryPage(): JSX.Element {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { hasCapability } = useAuth();


  const orderId = params.get('orderId');
  const wantsCheckout = params.get('checkout') === '1';
  const canOperate = hasCapability(Capability.POS_OPERATE);
  const canCheckout = hasCapability(Capability.POS_CHECKOUT);

  const lineSeq = useRef(0);
  const nextKey = useCallback((): string => {
    lineSeq.current += 1;
    return `line-${lineSeq.current}`;
  }, []);
  // The shadcn Input is a plain function component, so it cannot take a ref. Holding the wrapper
  // and reaching for its input keeps the F2/"/" shortcut working without patching the primitive.
  const searchWrapRef = useRef<HTMLDivElement | null>(null);
  const focusSearch = useCallback(() => {
    searchWrapRef.current?.querySelector('input')?.focus();
  }, []);

  const [serverOrder, setServerOrder] = useState<PosOrderDetailDto | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);

  /* The row that just changed. Cleared on a timer so re-adding the same dish re-triggers the
     animation instead of the class sticking and the second tap looking like nothing happened. */
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<number | null>(null);
  const flash = useCallback((key: string) => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    setFlashKey(null);
    window.requestAnimationFrame(() => setFlashKey(key));
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1200);
  }, []);
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  const [orderType, setOrderType] = useState<PosOrderType>(() => {
    const requested = params.get('type');
    return isOrderType(requested) ? requested : PosOrderType.TAKEAWAY;
  });
  const [entityId, setEntityId] = useState<string | null>(null);
  const [pickedEntity, setPickedEntity] = useState<EntityDto | null>(null);
  const [entityName, setEntityName] = useState('');
  const [entityPhone, setEntityPhone] = useState('');
  const [entityAddress, setEntityAddress] = useState('');
  const [tableLabel, setTableLabel] = useState('');
  const [pax, setPax] = useState('0');
  const [scheduledFor, setScheduledFor] = useState('');
  const [notes, setNotes] = useState('');
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [menuCode, setMenuCode] = useState(() => readStored('pos-menu-code', ''));
  const [activeCategory, setActiveCategory] = useState(() =>
    readStored('pos-active-category', ALL_CATEGORIES),
  );
  const [productSearch, setProductSearch] = useState(() => readStored('pos-product-search', ''));

  useEffect(() => {
    localStorage.setItem('pos-menu-code', menuCode);
  }, [menuCode]);
  useEffect(() => {
    localStorage.setItem('pos-active-category', activeCategory);
  }, [activeCategory]);
  useEffect(() => {
    localStorage.setItem('pos-product-search', productSearch);
  }, [productSearch]);

  const [variantFor, setVariantFor] = useState<ResolvedMenuItemDto | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState({ name: '', price: '', quantity: '1' });
  const [entityPickerOpen, setEntityPickerOpen] = useState(false);
  const [checkoutOrder, setCheckoutOrder] = useState<PosOrderDetailDto | null>(null);
  /* Tender methods currently selected in the checkout dialog — the customer display turns its
     pay QR on the moment UPI is among them, before a rupee has moved. */
  const [checkoutMethods, setCheckoutMethods] = useState<PosPaymentMethod[]>([]);
  /* Which counter's customer display this till mirrors to. Empty means no display attached. */
  const [cdsCounterId, setCdsCounterId] = useState(() => readStored('pos-cds-counter-id', ''));
  useEffect(() => {
    localStorage.setItem('pos-cds-counter-id', cdsCounterId);
  }, [cdsCounterId]);

  const { data: cdsCounters } = useQuery({
    queryKey: ['counters', 'cds-picker'],
    queryFn: () => countersApi.list({ status: MasterStatus.ACTIVE, page: 1, pageSize: 100 }),
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [lineEditKey, setLineEditKey] = useState<string | null>(null);
  const [lineEditDraft, setLineEditDraft] = useState({ quantity: '1', unitPrice: '0', notes: '' });

  /* Column widths, in pixels, for the cart grid. Dragging a header divider writes here and the
     value is mirrored to localStorage, so a till keeps the operator's layout across shifts. */
  const [cartCols, setCartCols] = useState<number[]>(() =>
    readStored('pos-cart-cols', [64, 72, 76], (raw) => {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) && parsed.length === 3 && parsed.every((n) => typeof n === 'number')
        ? (parsed as number[])
        : [64, 72, 76];
    }),
  );

  useEffect(() => {
    localStorage.setItem('pos-cart-cols', JSON.stringify(cartCols));
  }, [cartCols]);

  const [cardSize, setCardSize] = useState(() =>
    readStored('pos-card-size', 5, Number),
  );

  useEffect(() => {
    localStorage.setItem('pos-card-size', String(cardSize));
  }, [cardSize]);
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'pos-entry-panels',
    storage: localStorage,
  });
  type PanelOrder = 'menu-products-ticket' | 'ticket-products-menu' | 'products-menu-ticket';
  const [panelOrder, setPanelOrder] = useState<PanelOrder>(() =>
    readStored('pos-panel-order', 'menu-products-ticket'),
  );

  useEffect(() => {
    localStorage.setItem('pos-panel-order', panelOrder);
  }, [panelOrder]);

  const createOrder = useCreatePosOrder();
  const updateOrder = useUpdatePosOrder();
  const setStatus = useSetPosOrderStatus();
  const busy = createOrder.isPending || updateOrder.isPending || setStatus.isPending;

  /* ------------------------------------------------------------------- menus */

  const menuListQuery = useMemo(
    () => ({ status: MasterStatus.ACTIVE, page: 1, pageSize: 100 }),
    [],
  );
  const { data: menuPage } = useMenus(menuListQuery);
  // An unpublished menu has no resolved tree — the server refuses to serve a draft to a till.
  const publishedMenus = useMemo(
    () => (menuPage?.items ?? []).filter((menu) => menu.publishedAt !== null),
    [menuPage],
  );
  const selectedMenu = publishedMenus.find((menu) => menu.code === menuCode) ?? null;
  const menuId = selectedMenu?.id ?? serverOrder?.menuId ?? null;

  const {
    data: tree,
    isLoading: treeLoading,
    isError: treeFailed,
  } = useQuery({
    queryKey: ['menu-tree', menuCode],
    queryFn: () => menusApi.tree(menuCode),
    enabled: menuCode !== '',
  });

  /* ----------------------------------------------------------- loading a ticket */

  const { data: loadedOrder, isLoading: orderLoading } = usePosOrder(orderId);
  const seededIdRef = useRef<string | null>(null);

  const seed = useCallback(
    (order: PosOrderDetailDto) => {
      setServerOrder(order);
      setOrderType(order.orderType);
      setEntityId(order.entityId);
      setPickedEntity((previous) =>
        previous !== null && previous.id === order.entityId ? previous : null,
      );
      setEntityName(order.entityId === null ? (order.entityName ?? '') : '');
      setEntityPhone(order.entityId === null ? (order.entityPhone ?? '') : '');
      setEntityAddress(order.entityId === null ? (order.entityAddress ?? '') : '');
      setTableLabel(order.tableLabel ?? '');
      setPax(String(order.pax));
      setScheduledFor(order.scheduledFor === null ? '' : toLocalInput(order.scheduledFor));
      setNotes(order.notes ?? '');

      const nextLines = order.items
        .filter((item) => item.status === PosOrderItemStatus.ACTIVE)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map<CartLine>((item) => ({
          key: nextKey(),
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          customItemName: item.customItemName,
          name: item.itemName,
          variantName: item.variantName,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          allowDecimalQuantity: item.allowDecimalQuantity,
          notes: item.notes,
          discountType: item.discountType,
          discountValue: item.discountValue,
        }));
      setLines(nextLines);
      setSavedSignature(
        signatureOf({
          orderType: order.orderType,
          entityId: order.entityId,
          menuId: order.menuId,
          lines: nextLines,
        }),
      );
    },
    [nextKey],
  );

  useEffect(() => {
    if (loadedOrder === undefined) return;
    if (seededIdRef.current === loadedOrder.id) return;
    seededIdRef.current = loadedOrder.id;
    seed(loadedOrder);
  }, [loadedOrder, seed]);

  // Leaving `orderId` behind (the "New sale" path) has to clear the till, not leave the previous
  // customer's lines sitting on a fresh ticket.
  useEffect(() => {
    if (orderId !== null) return;
    seededIdRef.current = null;
    setServerOrder(null);
    setLines([]);
    setEntityId(null);
    setPickedEntity(null);
    setEntityName('');
    setEntityPhone('');
    setEntityAddress('');
    setTableLabel('');
    setPax('0');
    setScheduledFor('');
    setNotes('');
    setSavedSignature(null);
    setError(null);
  }, [orderId]);

  /**
   * Pick a menu once: the ticket's own, else the first published one.
   *
   * Deliberately no fallback when an existing ticket's menu is no longer published — silently
   * re-pointing it at a different menu would re-price the whole bill behind the operator's back.
   * The selector stays empty instead, and `menuId` below keeps sending the original.
   */
  useEffect(() => {
    if (menuCode !== '' || publishedMenus.length === 0) return;
    if (serverOrder !== null && serverOrder.menuId !== null) {
      const own = publishedMenus.find((menu) => menu.id === serverOrder.menuId);
      if (own !== undefined) setMenuCode(own.code);
      return;
    }
    const first = publishedMenus[0];
    if (first !== undefined) setMenuCode(first.code);
  }, [menuCode, publishedMenus, serverOrder]);

  /* ------------------------------------------------------------------ entity */

  const { data: fetchedEntity } = useEntity(entityId);
  const entity =
    pickedEntity !== null && pickedEntity.id === entityId ? pickedEntity : (fetchedEntity ?? null);

  /* -------------------------------------------------------------------- cart */

  const readOnly =
    serverOrder !== null &&
    (TERMINAL_POS_ORDER_STATUSES as readonly string[]).includes(serverOrder.status);
  const editable = canOperate && !readOnly;

  const currentSignature = signatureOf({ orderType, entityId, menuId, lines });
  const dirty = savedSignature === null || savedSignature !== currentSignature;

  const estimatedGross = lines.reduce((sum, line) => sum + lineGross(line), 0);
  const estimatedDiscount = lines.reduce((sum, line) => sum + lineDiscount(line), 0);
  const estimatedNet = estimatedGross - estimatedDiscount;

  /* The customer display mirrors this ticket as it is rung up — debounced so a burst of taps
     repaints once, and cleared the moment the till holds nothing the customer should see. */
  const cdsCounterIdRef = useRef(cdsCounterId);
  cdsCounterIdRef.current = cdsCounterId;
  useEffect(() => {
    if (cdsCounterId === '') return;
    const timer = window.setTimeout(() => {
      if (lines.length === 0) {
        clearCdsLive(cdsCounterId);
        return;
      }
      publishCdsLive({
        counterId: cdsCounterId,
        orderNumber: serverOrder?.orderNumber ?? null,
        lines: lines.map((line) => ({
          itemName: line.name,
          variantName: line.variantName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: Math.round(lineNet(line) * 100) / 100,
        })),
        subtotalAmount: Math.round(estimatedGross * 100) / 100,
        discountAmount: Math.round(estimatedDiscount * 100) / 100,
        totalAmount: Math.round(estimatedNet * 100) / 100,
        paymentMethods: checkoutMethods,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [cdsCounterId, lines, serverOrder, checkoutMethods, estimatedGross, estimatedDiscount, estimatedNet]);

  useEffect(
    () => () => {
      if (cdsCounterIdRef.current !== '') clearCdsLive(cdsCounterIdRef.current);
      disconnectCdsLive();
    },
    [],
  );

  /* How much of each dish is already on the ticket, keyed by food item so a card shows the sum
     across its portions — "3 on the ticket" is the useful answer, not three separate counts. */
  const cartQuantities = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of lines) {
      if (line.menuItemId === null) continue;
      totals.set(line.menuItemId, (totals.get(line.menuItemId) ?? 0) + line.quantity);
    }
    return totals;
  }, [lines]);

  const addCatalogueLine = useCallback(
    (item: ResolvedMenuItemDto, variant: ResolvedMenuVariantDto | null) => {
      const price = variant !== null ? variant.price : (item.basePrice ?? 0);
      setLines((rows) => {
        const match = rows.find(
          (row) =>
            row.menuItemId === item.foodItemId &&
            row.variantId === (variant?.id ?? null) &&
            row.notes === null &&
            row.discountType === PosDiscountType.NONE,
        );
        if (match !== undefined) {
          flash(match.key);
          return rows.map((row) =>
            row.key === match.key ? { ...row, quantity: row.quantity + 1 } : row,
          );
        }
        const key = nextKey();
        flash(key);
        return [
          ...rows,
          {
            key,
            menuItemId: item.foodItemId,
            variantId: variant?.id ?? null,
            customItemName: null,
            name: item.name,
            variantName: variant?.name ?? null,
            unitPrice: price,
            quantity: 1,
            allowDecimalQuantity:
              variant?.allowDecimalQuantity ?? item.allowDecimalQuantity ?? false,
            notes: null,
            discountType: PosDiscountType.NONE,
            discountValue: 0,
          },
        ];
      });
    },
    [nextKey, flash],
  );

  function onProductTap(item: ResolvedMenuItemDto): void {
    if (item.variants.length >= 2) {
      setVariantFor(item);
      return;
    }
    addCatalogueLine(item, item.variants[0] ?? null);
  }

  function addCustomLine(): void {
    const name = customDraft.name.trim();
    const price = toNumber(customDraft.price);
    const quantity = toNumber(customDraft.quantity);
    if (name === '' || quantity <= 0) return;
    const key = nextKey();
    flash(key);
    setLines((rows) => [
      ...rows,
      {
        key,
        menuItemId: null,
        variantId: null,
        customItemName: name,
        name,
        variantName: null,
        unitPrice: price,
        quantity,
        allowDecimalQuantity: false,
        notes: null,
        discountType: PosDiscountType.NONE,
        discountValue: 0,
      },
    ]);
    setCustomDraft({ name: '', price: '', quantity: '1' });
    setCustomOpen(false);
  }

  function patchLine(key: string, patch: Partial<CartLine>): void {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function openLineEdit(line: CartLine): void {
    setLineEditKey(line.key);
    setLineEditDraft({
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      notes: line.notes ?? '',
    });
  }

  function saveLineEdit(): void {
    if (lineEditKey === null) return;
    const line = lines.find((row) => row.key === lineEditKey);
    if (line === undefined) return;
    let quantity = Number(lineEditDraft.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
    if (!line.allowDecimalQuantity) quantity = Math.round(quantity);
    quantity = Math.round(quantity * 1000) / 1000;
    let unitPrice = Number(lineEditDraft.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) unitPrice = 0;
    patchLine(lineEditKey, {
      quantity,
      unitPrice: Math.round(unitPrice * 100) / 100,
      notes: lineEditDraft.notes.trim() || null,
    });
    flash(lineEditKey);
    setLineEditKey(null);
  }

  function setQuantity(line: CartLine, value: number): void {
    if (!Number.isFinite(value) || value <= 0) return;
    patchLine(line.key, {
      quantity: line.allowDecimalQuantity ? Math.round(value * 1000) / 1000 : Math.round(value),
    });
  }

  /**
   * Arrow keys walk the cart, +/- step the quantity, Delete drops the line and Enter opens the
   * detail dialog — so a ticket can be corrected without the operator's hand leaving the keyboard.
   * Typing inside a cell is left alone apart from the vertical arrows, which move between rows.
   */
  function onCartKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>, line: CartLine): void {
    const inField = (event.target as HTMLElement).tagName === 'INPUT';
    const move = (delta: number): void => {
      event.preventDefault();
      const index = lines.findIndex((row) => row.key === line.key);
      const next = lines[index + delta];
      if (next === undefined) return;
      document.querySelector<HTMLElement>(`[data-cart-row="${next.key}"]`)?.focus();
    };
    if (event.key === 'ArrowDown') return move(1);
    if (event.key === 'ArrowUp') return move(-1);
    if (inField) return;
    if (!editable) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setQuantity(line, line.quantity + (line.allowDecimalQuantity ? 0.1 : 1));
    } else if (event.key === '-') {
      event.preventDefault();
      setQuantity(line, line.quantity - (line.allowDecimalQuantity ? 0.1 : 1));
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setLines((rows) => rows.filter((row) => row.key !== line.key));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openLineEdit(line);
    }
  }

  /** Drag a header divider. Pointer capture keeps the drag alive outside the 1px handle. */
  function startColumnResize(event: React.PointerEvent<HTMLElement>, column: number): void {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = cartCols[column] ?? 64;
    const onMove = (moveEvent: PointerEvent): void => {
      const next = Math.min(160, Math.max(44, startWidth + (moveEvent.clientX - startX)));
      setCartCols((widths) => widths.map((width, index) => (index === column ? next : width)));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /* ------------------------------------------------------------------ writing */

  function itemsPayload(): PosOrderItemInput[] {
    return lines.map((line, index) => {
      const shared = {
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountType: line.discountType,
        discountValue: line.discountValue,
        notes: line.notes,
        sortOrder: index,
      };
      return line.menuItemId !== null
        ? { ...shared, menuItemId: line.menuItemId, variantId: line.variantId }
        : { ...shared, customItemName: line.customItemName };
    });
  }

  async function persist(status: PosOrderStatus): Promise<PosOrderDetailDto | null> {
    setError(null);
    const quickSale = orderType === PosOrderType.QUICK_SALE;
    const walkIn = !quickSale && entityId === null;
    const header = {
      orderType,
      menuId,
      /* Which counter rang this ticket up. Without it the customer display has nothing to bind
         its settled bill to, and an unrouted dish has no counter board to fall back to. */
      counterId: cdsCounterId === '' ? null : cdsCounterId,
      entityId: quickSale ? null : entityId,
      entityName: walkIn ? entityName.trim() || null : null,
      entityPhone: walkIn ? entityPhone.trim() || null : null,
      entityAddress: walkIn ? entityAddress.trim() || null : null,
      tableLabel: orderType === PosOrderType.DINE_IN ? tableLabel.trim() || null : null,
      pax: orderType === PosOrderType.DINE_IN ? Math.max(0, Math.trunc(toNumber(pax))) : 0,
      scheduledFor: fromLocalInput(scheduledFor),
      notes: notes.trim() || null,
    };

    try {
      let result: PosOrderDetailDto;
      if (serverOrder === null) {
        result = await createOrder.mutateAsync({ ...header, status, items: itemsPayload() });
      } else {
        result = await updateOrder.mutateAsync({
          id: serverOrder.id,
          body: { ...header, items: itemsPayload(), expectedRevision: serverOrder.revision },
        });
        if (result.status !== status) {
          result = await setStatus.mutateAsync({
            id: result.id,
            body: {
              status,
              ...(status === PosOrderStatus.SCHEDULED
                ? { scheduledFor: fromLocalInput(scheduledFor) }
                : {}),
            },
          });
        }
      }
      seededIdRef.current = result.id;
      seed(result);
      if (orderId !== result.id) {
        const next = new URLSearchParams(params);
        next.set('orderId', result.id);
        next.delete('type');
        next.delete('checkout');
        setParams(next, { replace: true });
      }
      return result;
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
      return null;
    }
  }

  async function saveAs(status: PosOrderStatus, message: string): Promise<void> {
    const result = await persist(status);
    if (result !== null) notify.success(message);
  }

  async function startCheckout(): Promise<void> {
    const result = await persist(PosOrderStatus.OPEN);
    if (result !== null) setCheckoutOrder(result);
  }

  async function confirmCancel(): Promise<void> {
    if (serverOrder === null) return;
    try {
      const result = await setStatus.mutateAsync({
        id: serverOrder.id,
        body: { status: PosOrderStatus.CANCELLED, reason: 'Cancelled at the counter' },
      });
      seed(result);
      notify.success('Ticket cancelled.');
    } catch (err) {
      notify.fromError(err);
    } finally {
      setCancelOpen(false);
    }
  }

  /* ---------------------------------------------------------------- checkout=1 */

  const autoCheckoutRef = useRef(false);
  useEffect(() => {
    if (!wantsCheckout || autoCheckoutRef.current) return;
    if (serverOrder === null || !canCheckout) return;
    if ((TERMINAL_POS_ORDER_STATUSES as readonly string[]).includes(serverOrder.status)) return;
    autoCheckoutRef.current = true;
    setCheckoutOrder(serverOrder);
  }, [wantsCheckout, serverOrder, canCheckout]);

  /* ---------------------------------------------------------------- keyboard */

  const dialogOpen =
    variantFor !== null ||
    customOpen ||
    entityPickerOpen ||
    checkoutOrder !== null ||
    cancelOpen ||
    infoOpen ||
    lineEditKey !== null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.getAttribute('role') === 'combobox');

      if (event.key === 'F2' || (event.key === '/' && !typing)) {
        event.preventDefault();
        focusSearch();
        return;
      }
      // Radix owns Escape while anything is layered over the till, and a focused field owns it
      // for clearing itself. Only a bare Escape on the workspace leaves.
      if (event.key === 'Escape' && !dialogOpen && !typing) navigate('/pos');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen, navigate, focusSearch]);

  /* -------------------------------------------------------------- products */

  const categories = useMemo(() => tree?.categories ?? [], [tree]);
  const products = useMemo(() => {
    const source =
      activeCategory === ALL_CATEGORIES
        ? categories.flatMap((category) => category.items)
        : (categories.find((category) => category.id === activeCategory)?.items ?? []);
    const term = productSearch.trim().toLowerCase();
    return source
      .filter((item) => item.posVisible && item.availability === AvailabilityStatus.AVAILABLE)
      .filter((item) => term === '' || item.name.toLowerCase().includes(term))
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [categories, activeCategory, productSearch]);

  /* ----------------------------------------------------------- action reasons */

  const closedReason = readOnly
    ? `A ${serverOrder?.status.toLowerCase()} ticket can no longer be edited.`
    : null;
  const noCapabilityReason = canOperate ? null : 'Taking an order needs the POS operate capability.';
  const emptyReason = lines.length === 0 ? 'Add at least one item to the ticket.' : null;

  // A ticket already on the counter cannot be walked backwards into a draft or a schedule; the
  // server refuses the transition, so the button says so instead of finding out.
  const transitionReason = (target: PosOrderStatus): string | null =>
    serverOrder === null || canTransitionPosOrderStatus(serverOrder.status, target)
      ? null
      : `Cannot move a ${serverOrder.status.toLowerCase()} ticket to ${target.toLowerCase()}.`;

  const draftReason =
    noCapabilityReason ?? closedReason ?? transitionReason(PosOrderStatus.DRAFT);
  const scheduleReason =
    noCapabilityReason ??
    closedReason ??
    transitionReason(PosOrderStatus.SCHEDULED) ??
    emptyReason ??
    (scheduledFor === '' ? 'Schedule the order forward.' : null);
  const placeReason =
    noCapabilityReason ?? closedReason ?? transitionReason(PosOrderStatus.OPEN) ?? emptyReason;
  const checkoutReason = canCheckout
    ? (closedReason ?? emptyReason)
    : 'Settling a bill needs the POS checkout capability.';
  const editReason = noCapabilityReason ?? closedReason;

  /* ------------------------------------------------------------------- panes */

  const menuPane = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SelectField
        label="Menu"
        helperText={
          publishedMenus.length === 0
            ? 'No published menu yet — publish one in Menu Master before selling from it.'
            : undefined
        }
        value={menuCode}
        onChange={(value) => {
          setMenuCode(value);
          setActiveCategory(ALL_CATEGORIES);
        }}
        options={toOptions(
          publishedMenus,
          (menu) => menu.code,
          (menu) => menu.name,
        )}
        placeholder="Select a menu…"
      />

      <Separator />

      <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
        <div className="flex flex-col gap-1">
          <CategoryButton
            label="All items"
            active={activeCategory === ALL_CATEGORIES}
            onClick={() => setActiveCategory(ALL_CATEGORIES)}
          />
          {categories.map((category) => (
            <CategoryButton
              key={category.id}
              label={category.name}
              count={
                category.items.filter(
                  (item) => item.posVisible && item.availability === AvailabilityStatus.AVAILABLE,
                ).length
              }
              active={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  const productPane = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <div ref={searchWrapRef} className="min-w-0 flex-1">
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              placeholder="Search dishes — press / or F2"
              aria-label="Search dishes"
              value={productSearch}
              onChange={(event) => setProductSearch(event.target.value)}
            />
            {productSearch !== '' && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Clear dish search"
                  onClick={() => setProductSearch('')}
                >
                  <XIcon />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => setCustomOpen(true)}
          disabled={!editable}
          title={editReason ?? undefined}
        >
          <PlusIcon data-icon="inline-start" />
          Custom item
        </Button>
      </div>

      <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
        {menuCode === '' && (
          <EmptyState
            title="Pick a menu to sell from"
            description="Only an active, published menu resolves to a sellable list of dishes. Choose one on the left, or publish one in Menu Master."
          />
        )}
        {menuCode !== '' && treeLoading && <CardGridSkeleton count={8} />}
        {menuCode !== '' && !treeLoading && treeFailed && (
          <EmptyState
            title="That menu could not be resolved"
            description="The server only serves a published, active menu to a till. Publish it in Menu Master, or pick another menu."
          />
        )}
        {menuCode !== '' && !treeLoading && !treeFailed && products.length === 0 && (
          <EmptyState
            variant={productSearch.trim() === '' ? 'empty' : 'no-results'}
            title={
              productSearch.trim() === ''
                ? 'Nothing sellable in this category'
                : 'No dish matches that'
            }
            description={
              productSearch.trim() === ''
                ? 'Items appear here once they are assigned to this menu and marked visible on POS.'
                : 'Try a shorter search, or add it as a custom item.'
            }
          />
        )}
        {products.length > 0 && (
          /* `auto-fill` with a fixed track, not `auto-fit` with `1fr`: the operator picked a card
             size, so a row holding one card must not blow it up to the full pane width. */
          <div
            className="grid justify-start gap-2 pb-1"
            style={{ gridTemplateColumns: `repeat(auto-fill, ${8 + cardSize * 0.625}rem)` }}
          >
            {products.map((item) => (
              <ProductButton
                key={item.id}
                item={item}
                quantity={cartQuantities.get(item.foodItemId) ?? 0}
                disabled={!editable}
                onClick={() => onProductTap(item)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );

  const ticketPane = (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {error !== null && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ScrollArea className="-mx-1 min-h-0 flex-1 px-1">
        <div className="flex flex-col gap-3 pb-1">
          {/* Lines */}
          {lines.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">
              Tap a dish to start the ticket.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-xs">
              <colgroup>
                <col />
                <col style={{ width: `${cartCols[0]}px` }} />
                <col style={{ width: `${cartCols[1]}px` }} />
                <col style={{ width: `${cartCols[2]}px` }} />
                <col style={{ width: '2rem' }} />
              </colgroup>
              {/* Sticky so the operator still knows which column is which halfway down a long ticket. */}
              <thead className="bg-card sticky top-0 z-10">
                <tr className="text-muted-foreground border-b text-left">
                  <th className="py-1 pl-1 font-medium">SN / Item</th>
                  {(['Qty', 'Rate', 'Amount'] as const).map((label, column) => (
                    <th key={label} className="relative py-1 text-center font-medium">
                      {label}
                      <span
                        role="separator"
                        aria-label={`Resize ${label} column`}
                        onPointerDown={(event) => startColumnResize(event, column)}
                        className="hover:bg-primary absolute inset-y-0 -left-1 w-2 cursor-col-resize"
                      />
                    </th>
                  ))}
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr
                    key={line.key}
                    tabIndex={0}
                    data-cart-row={line.key}
                    onKeyDown={(event) => onCartKeyDown(event, line)}
                    onDoubleClick={() => editable && openLineEdit(line)}
                    className={cn(
                      'focus-visible:ring-ring/60 border-b outline-none last:border-b-0 focus-visible:ring-2',
                      flashKey === line.key && 'pos-line-flash',
                    )}
                  >
                    <td className="py-1 pl-1 align-middle">
                      <div className="flex flex-col">
                        <span className="truncate font-medium">
                          {index + 1}. {line.name}
                        </span>
                        {line.variantName !== null && (
                          <span className="text-muted-foreground truncate">{line.variantName}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-1 align-middle">
                      <Input
                        type="number"
                        min={0.001}
                        step={line.allowDecimalQuantity ? 0.001 : 1}
                        value={line.quantity}
                        onChange={(event) => setQuantity(line, Number(event.target.value))}
                        disabled={!editable}
                        className="h-7 px-1 text-center tabular-nums"
                        aria-label={`Quantity for ${line.name}`}
                      />
                    </td>
                    <td className="py-1 align-middle">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={line.unitPrice}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value >= 0) {
                            patchLine(line.key, { unitPrice: Math.round(value * 100) / 100 });
                          }
                        }}
                        disabled={!editable}
                        className="h-7 px-1 text-center tabular-nums"
                        aria-label={`Rate for ${line.name}`}
                      />
                    </td>
                    <td className="py-1 pr-1 text-right align-middle tabular-nums">
                      {formatMoney(lineNet(line))}
                    </td>
                    <td className="py-1 pr-1 text-right align-middle">
                      {editable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          aria-label={`Remove ${line.name}`}
                          onClick={() =>
                            setLines((rows) => rows.filter((row) => row.key !== line.key))
                          }
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        </div>
      </ScrollArea>

      <Separator />

      {/* Totals: authoritative once the server has priced the ticket, honestly labelled until then. */}
      <div className="flex flex-col gap-0.5">
        {serverOrder !== null && !dirty ? (
          <>
            <TotalRow label="Subtotal" value={serverOrder.subtotalAmount} />
            {serverOrder.discountAmount !== 0 && (
              <TotalRow label="Discount" value={-serverOrder.discountAmount} />
            )}
            <TotalRow label="Tax" value={serverOrder.taxAmount} />
            {serverOrder.roundOffAmount !== 0 && (
              <TotalRow label="Round off" value={serverOrder.roundOffAmount} />
            )}
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">Total</span>
              <span className="font-heading text-xl font-semibold tabular-nums">
                {formatMoney(serverOrder.totalAmount)}
              </span>
            </div>
          </>
        ) : (
          <>
            <TotalRow label="Items" value={estimatedGross} />
            {estimatedDiscount > 0 && <TotalRow label="Line discounts" value={-estimatedDiscount} />}
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">Estimated</span>
              <span className="font-heading text-xl font-semibold tabular-nums">
                {formatMoney(estimatedNet)}
              </span>
            </div>
            <p className="text-muted-foreground text-[0.6875rem]">
              Estimated. Tax and round-off are added by the server.
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy || draftReason !== null}
            title={draftReason ?? undefined}
            onClick={() => void saveAs(PosOrderStatus.DRAFT, 'Ticket parked as a draft.')}
          >
            {busy && <Spinner data-icon="inline-start" />}
            Save draft
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || scheduleReason !== null}
            title={scheduleReason ?? undefined}
            onClick={() => void saveAs(PosOrderStatus.SCHEDULED, 'Order scheduled.')}
          >
            <ClockIcon data-icon="inline-start" />
            Schedule
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy || placeReason !== null}
            title={placeReason ?? undefined}
            onClick={() => void saveAs(PosOrderStatus.OPEN, 'Order placed.')}
          >
            Place order
          </Button>
          <Button
            type="button"
            disabled={busy || checkoutReason !== null}
            title={checkoutReason ?? undefined}
            onClick={() => void startCheckout()}
          >
            Checkout
          </Button>
        </div>
        {serverOrder !== null && !readOnly && canOperate && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => setCancelOpen(true)}
          >
            Cancel this order
          </Button>
        )}
      </div>
    </div>
  );

  /* -------------------------------------------------------------------- page */

  if (orderId !== null && orderLoading && serverOrder === null) {
    return (
      <>
        <BackButton to="/pos" label="Back to the counter" />
        <CardGridSkeleton count={6} />
      </>
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <BackButton to="/pos" label="" />
        <span className="text-sm font-semibold">
          {serverOrder === null ? 'New ticket' : serverOrder.orderNumber}
        </span>
        {serverOrder !== null && <StatusChip status={serverOrder.status} />}
        <SelectField
          value={orderType}
          onChange={(value) => {
            const next = value as PosOrderType;
            setOrderType(next);
            if (next === PosOrderType.QUICK_SALE) {
              setEntityId(null);
              setPickedEntity(null);
              setEntityName('');
              setEntityPhone('');
              setEntityAddress('');
            }
          }}
          options={ORDER_TYPES.map((type) => ({ value: type, label: ORDER_TYPE_LABEL[type] }))}
          triggerClassName="h-8 w-32"
          disabled={!editable}
        />
        {orderType !== PosOrderType.QUICK_SALE && (
          <>
            {entityId !== null ? (
              <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
                {entity?.name ?? serverOrder?.entityName ?? 'Customer'}
                {entityPhone !== '' || (serverOrder?.entityPhone ?? '') !== ''
                  ? ` · ${entityPhone || serverOrder?.entityPhone}`
                  : ''}
              </span>
            ) : entityName !== '' ? (
              <span className="max-w-[10rem] truncate text-xs text-muted-foreground">
                {entityName}
                {entityPhone !== '' ? ` · ${entityPhone}` : ''}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Walk-in</span>
            )}
          </>
        )}
        {scheduledFor !== '' && (
          <span className="text-xs text-muted-foreground">
            {scheduleLabel(fromLocalInput(scheduledFor))}
          </span>
        )}
        {orderType === PosOrderType.DINE_IN && (tableLabel !== '' || pax !== '0') && (
          <span className="text-xs text-muted-foreground">
            {tableLabel !== '' ? `Table ${tableLabel}` : ''}
            {tableLabel !== '' && pax !== '0' ? ' · ' : ''}
            {pax !== '0' ? `${pax} covers` : ''}
          </span>
        )}
        {orderType === PosOrderType.DELIVERY && entityAddress !== '' && (
          <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{entityAddress}</span>
        )}
        {notes !== '' && (
          <span className="max-w-[10rem] truncate text-xs text-muted-foreground">{notes}</span>
        )}
        <div className="flex-1" />
        {editable && (
          <Button type="button" variant="outline" size="xs" onClick={() => setInfoOpen(true)}>
            Edit info
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)}>
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      {readOnly && serverOrder !== null && (
        <Alert
          className="mb-2"
          variant={serverOrder.status === PosOrderStatus.CANCELLED ? 'destructive' : 'default'}
        >
          <AlertTitle>
            This ticket is {serverOrder.status === PosOrderStatus.COMPLETED ? 'settled' : 'cancelled'}{' '}
            and read-only
          </AlertTitle>
          <AlertDescription>
            The server refuses edits to a {serverOrder.status.toLowerCase()} ticket — a settled bill
            is reversed by a void, not edited. Start a new sale from the counter instead.
          </AlertDescription>
        </Alert>
      )}

      <div className="h-[calc(100dvh-6.5rem)] min-h-[36rem]">
        <ResizablePanelGroup
          id="pos-entry-panels"
          orientation="horizontal"
          className="h-full"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          {panelOrder === 'ticket-products-menu' ? (
            <>
              <ResizablePanel id="pos-ticket" defaultSize="30" minSize="20" maxSize="55">
                <aside className="bg-card h-full rounded-lg border p-2">{ticketPane}</aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-products" defaultSize="54" minSize="30">
                <section className="h-full min-w-0 pl-1 pr-1">{productPane}</section>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-menu" defaultSize="16" minSize="10" maxSize="30">
                <aside className="bg-card h-full rounded-lg border p-2">{menuPane}</aside>
              </ResizablePanel>
            </>
          ) : panelOrder === 'products-menu-ticket' ? (
            <>
              <ResizablePanel id="pos-products" defaultSize="54" minSize="30">
                <section className="h-full min-w-0 pl-1 pr-1">{productPane}</section>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-menu" defaultSize="16" minSize="10" maxSize="30">
                <aside className="bg-card h-full rounded-lg border p-2">{menuPane}</aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-ticket" defaultSize="30" minSize="20" maxSize="55">
                <aside className="bg-card h-full rounded-lg border p-2">{ticketPane}</aside>
              </ResizablePanel>
            </>
          ) : (
            <>
              <ResizablePanel id="pos-menu" defaultSize="16" minSize="10" maxSize="30">
                <aside className="bg-card h-full rounded-lg border p-2">{menuPane}</aside>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-products" defaultSize="54" minSize="30">
                <section className="h-full min-w-0 pl-1 pr-1">{productPane}</section>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel id="pos-ticket" defaultSize="30" minSize="20" maxSize="55">
                <aside className="bg-card h-full rounded-lg border p-2">{ticketPane}</aside>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>

      {/* Variant chooser */}
      <Dialog open={variantFor !== null} onOpenChange={(next) => !next && setVariantFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{variantFor?.name}</DialogTitle>
            <DialogDescription>Which portion?</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            {(variantFor?.variants ?? [])
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((variant) => {
                const image = variant.primaryMediaUrl ?? variantFor?.primaryMediaUrl ?? null;
                return (
                  <Button
                    key={variant.id}
                    type="button"
                    variant="outline"
                    className="touch-target h-auto justify-start gap-3 py-2"
                    disabled={variant.availability !== AvailabilityStatus.AVAILABLE}
                    onClick={() => {
                      if (variantFor !== null) addCatalogueLine(variantFor, variant);
                      setVariantFor(null);
                    }}
                  >
                    {image !== null && (
                      <img
                        src={image}
                        alt=""
                        className="size-12 rounded-md object-cover"
                        loading="lazy"
                      />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col items-start text-left">
                      <span className="w-full truncate text-sm font-medium">
                        {variant.name}
                        {variant.portionName !== null ? ` · ${variant.portionName}` : ''}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {variant.unit ?? 'NOS'}
                      </span>
                    </div>
                    <span className="tabular-nums">{formatMoney(variant.price)}</span>
                  </Button>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ad-hoc line */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a custom item</DialogTitle>
            <DialogDescription>
              For something not on the menu. An ad-hoc line carries no tax profile, so it is billed
              at zero tax — use a catalogue item wherever one exists.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField
              label="Item name"
              autoFocus
              required
              value={customDraft.name}
              onChange={(event) => setCustomDraft({ ...customDraft, name: event.target.value })}
              maxLength={LIMITS.CUSTOM_ITEM_NAME_MAX}
            />
            <NumberField
              label="Unit price"
              required
              value={customDraft.price}
              onChange={(event) => setCustomDraft({ ...customDraft, price: event.target.value })}
              min={LIMITS.PRICE_MIN}
              max={LIMITS.PRICE_MAX}
              step="0.01"
            />
            <NumberField
              label="Quantity"
              value={customDraft.quantity}
              onChange={(event) => setCustomDraft({ ...customDraft, quantity: event.target.value })}
              min={0}
              max={LIMITS.QUANTITY_MAX}
              step="0.001"
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCustomOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={addCustomLine}
              disabled={customDraft.name.trim() === '' || toNumber(customDraft.quantity) <= 0}
            >
              <SquarePenIcon data-icon="inline-start" />
              Add to ticket
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {entityPickerOpen && (
        <PosEntityPickerModal
          open
          allowWalkIn
          onClose={() => setEntityPickerOpen(false)}
          onSelect={(chosen) => {
            setPickedEntity(chosen);
            setEntityId(chosen?.id ?? null);
            if (chosen !== null) {
              setEntityName('');
              setEntityPhone('');
              setEntityAddress('');
            }
          }}
        />
      )}

      {/* Double-clicking a cart row lands here: the full line, not just the two inline cells. */}
      <Dialog
        open={lineEditKey !== null}
        onOpenChange={(open) => {
          if (!open) setLineEditKey(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          {(() => {
            const line = lines.find((row) => row.key === lineEditKey);
            if (line === undefined) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{line.name}</DialogTitle>
                  <DialogDescription>
                    {line.variantName ?? 'Edit quantity, rate and note.'}
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <NumberField
                    label="Quantity"
                    autoFocus
                    value={lineEditDraft.quantity}
                    onChange={(event) =>
                      setLineEditDraft({ ...lineEditDraft, quantity: event.target.value })
                    }
                    min={0.001}
                    max={LIMITS.QUANTITY_MAX}
                    step={line.allowDecimalQuantity ? '0.001' : '1'}
                  />
                  <NumberField
                    label="Rate"
                    value={lineEditDraft.unitPrice}
                    onChange={(event) =>
                      setLineEditDraft({ ...lineEditDraft, unitPrice: event.target.value })
                    }
                    min={LIMITS.PRICE_MIN}
                    max={LIMITS.PRICE_MAX}
                    step="0.01"
                  />
                  <TextField
                    label="Note"
                    multiline
                    rows={2}
                    value={lineEditDraft.notes}
                    onChange={(event) =>
                      setLineEditDraft({ ...lineEditDraft, notes: event.target.value })
                    }
                    maxLength={LIMITS.POS_ORDER_ITEM_NOTES_MAX}
                  />
                </FieldGroup>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setLineEditKey(null)}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={saveLineEdit}>
                    Save
                  </Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={infoOpen} onOpenChange={(open) => setInfoOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Order information</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <SelectField
              label="Order type"
              value={orderType}
              onChange={(value) => {
                const next = value as PosOrderType;
                setOrderType(next);
                if (next === PosOrderType.QUICK_SALE) {
                  setEntityId(null);
                  setPickedEntity(null);
                  setEntityName('');
                  setEntityPhone('');
                  setEntityAddress('');
                }
              }}
              options={ORDER_TYPES.map((type) => ({ value: type, label: ORDER_TYPE_LABEL[type] }))}
              disabled={!editable}
            />
            {orderType !== PosOrderType.QUICK_SALE && (
              <>
                <div className="flex items-end gap-2">
                  <TextField
                    label="Customer name"
                    value={entityName}
                    onChange={(event) => setEntityName(event.target.value)}
                    maxLength={LIMITS.ENTITY_NAME_MAX}
                    disabled={!editable}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEntityPickerOpen(true)}
                    disabled={!editable}
                  >
                    <UserRoundIcon data-icon="inline-start" />
                    Pick customer
                  </Button>
                </div>
                <TextField
                  label="Phone"
                  value={entityPhone}
                  onChange={(event) => setEntityPhone(event.target.value)}
                  maxLength={LIMITS.ENTITY_PHONE_MAX}
                  disabled={!editable}
                />
              </>
            )}
            <TextField
              label="Schedule for"
              type="datetime-local"
              helperText={
                scheduledFor === '' ? 'Required only when scheduling.' : scheduleLabel(fromLocalInput(scheduledFor))
              }
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              disabled={!editable}
            />
            {orderType === PosOrderType.DINE_IN && (
              <div className="grid grid-cols-2 gap-2">
                <TextField
                  label="Table"
                  value={tableLabel}
                  onChange={(event) => setTableLabel(event.target.value)}
                  maxLength={LIMITS.POS_TABLE_LABEL_MAX}
                  disabled={!editable}
                />
                <NumberField
                  label="Covers"
                  value={pax}
                  onChange={(event) => setPax(event.target.value)}
                  min={LIMITS.PAX_MIN}
                  max={LIMITS.PAX_MAX}
                  disabled={!editable}
                />
              </div>
            )}
            {orderType === PosOrderType.DELIVERY && (
              <TextField
                label="Delivery address"
                multiline
                rows={2}
                value={entityAddress}
                onChange={(event) => setEntityAddress(event.target.value)}
                maxLength={LIMITS.ENTITY_ADDRESS_MAX}
                disabled={!editable}
              />
            )}
            <TextField
              label="Notes"
              multiline
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              maxLength={LIMITS.POS_ORDER_NOTES_MAX}
              disabled={!editable}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" onClick={() => setInfoOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {checkoutOrder !== null && (
        <PosCheckoutModal
          open
          order={checkoutOrder}
          onPaymentMethodsChange={setCheckoutMethods}
          onClose={() => setCheckoutOrder(null)}
          onSettled={(settledOrder) => {
            setCheckoutOrder(null);
            if (settledOrder.orderType === PosOrderType.QUICK_SALE) {
              navigate(`/pos/entry?type=${PosOrderType.QUICK_SALE}`, { replace: true });
            } else {
              navigate('/pos');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={cancelOpen}
        title="Cancel this order"
        message={`Cancel ${serverOrder?.orderNumber ?? 'this ticket'}? A cancelled ticket is terminal — it cannot be reopened, only raised again as a new sale.`}
        confirmLabel="Cancel order"
        danger
        loading={setStatus.isPending}
        onConfirm={() => void confirmCancel()}
        onCancel={() => setCancelOpen(false)}
      />

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>POS display</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="card-size" className="text-sm font-medium">Card size</label>
                <span className="text-muted-foreground text-sm tabular-nums">{cardSize}</span>
              </div>
              <input
                id="card-size"
                type="range"
                min={1}
                max={10}
                step={1}
                value={cardSize}
                onChange={(event) => {
                  const next = Math.min(10, Math.max(1, Number(event.target.value)));
                  setCardSize(next);
                }}
                className="w-full accent-primary"
              />
              <p className="text-muted-foreground text-xs">1 smallest, 10 largest.</p>
            </div>
            {/* The one select component, not a hand-styled native one: this was the only
                control in the portal with its own height, its own focus treatment and a label
                that was never associated with it. */}
            <SelectField
              label="Panel order"
              value={panelOrder}
              onChange={(value) => setPanelOrder(value as PanelOrder)}
              options={[
                { value: 'menu-products-ticket', label: 'Menu · Products · Ticket' },
                { value: 'ticket-products-menu', label: 'Ticket · Products · Menu' },
                { value: 'products-menu-ticket', label: 'Products · Menu · Ticket' },
              ]}
            />
            <SelectField
              label="This till's counter"
              value={cdsCounterId === '' ? '__off__' : cdsCounterId}
              onChange={(value) => setCdsCounterId(value === '__off__' ? '' : value)}
              options={[
                { value: '__off__', label: 'Not set — no counter, no customer display' },
                ...(cdsCounters?.items ?? []).map((counter) => ({
                  value: counter.id,
                  label: counter.name,
                })),
              ]}
            />
            <p className="text-muted-foreground -mt-2 text-xs">
              Stamped on every ticket this till writes. Its customer display mirrors the ticket
              live and keeps the bill (with the UPI QR) on screen after checkout; the counter's
              Service KDS also picks up dishes that carry no routing of their own.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* --------------------------------------------------------------------- pieces */

function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-full border px-3 py-1.5 text-left text-sm outline-none transition-colors duration-150 focus-visible:ring-3',
        active
          ? 'bg-primary text-primary-foreground border-primary font-medium'
          : 'bg-card hover:bg-muted',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            active ? 'text-primary-foreground/80' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function ProductButton({
  item,
  quantity,
  disabled,
  onClick,
}: {
  item: ResolvedMenuItemDto;
  quantity: number;
  disabled: boolean;
  onClick: () => void;
}): JSX.Element {
  const onlyVariant = item.variants.length === 1 ? item.variants[0] : undefined;
  const price = onlyVariant?.price ?? item.basePrice;
  const multiple = item.variants.length >= 2;
  const image = item.primaryMediaUrl ?? onlyVariant?.primaryMediaUrl ?? null;
  const onTicket = quantity > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'bg-card hover:border-ring/70 focus-visible:border-ring focus-visible:ring-ring/50 relative flex flex-col overflow-hidden rounded-xl border text-left outline-none transition-colors duration-150 focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50',
        onTicket && 'border-primary/70',
      )}
    >
      {/* A running count of what this dish already contributes to the ticket. */}
      {onTicket && (
        <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 z-10 min-w-5 rounded-full px-1.5 text-center text-[0.6875rem] leading-5 font-semibold tabular-nums">
          {Number.isInteger(quantity) ? quantity : quantity.toFixed(3).replace(/\.?0+$/, '')}
        </span>
      )}
      {image && (
        <div className="bg-muted h-24 w-full shrink-0 overflow-hidden">
          <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}
      <div className="flex flex-1 flex-col justify-between gap-1 p-2">
        <span className="line-clamp-2 text-sm leading-snug font-medium">{item.name}</span>
        <span className="flex w-full items-end justify-between gap-2">
          <span className="text-muted-foreground min-w-0 truncate text-xs">
            {multiple
              ? `${item.variants.length} portions`
              : (onlyVariant?.name ?? item.unit)}
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {multiple ? 'Choose' : price === null ? '—' : formatMoney(price)}
          </span>
        </span>
      </div>
    </button>
  );
}

function TotalRow({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-xs tabular-nums">{formatMoney(value)}</span>
    </div>
  );
}
