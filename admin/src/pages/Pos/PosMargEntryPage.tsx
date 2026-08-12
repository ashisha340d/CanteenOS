import { useCallback, useEffect, useMemo, useState } from 'react';
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
  type PosOrderItemInput,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
} from '@menuboard/shared';
import {
  ArrowLeftIcon,
  CalculatorIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { SelectField, TextField } from '@/components/form/fields';
import { formatMoney, ORDER_TYPE_LABEL } from './posFormat';
import { PosCheckoutModal } from './PosCheckoutModal';
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
  unitPrice: number;
  quantity: number;
  freeQty: number;
  pack: string;
  batch: string;
  allowDecimalQuantity: boolean;
  discountType: PosDiscountType;
  discountValue: number;
  notes: string | null;
}

const ORDER_TYPES: PosOrderType[] = [
  PosOrderType.TAKEAWAY,
  PosOrderType.DINE_IN,
  PosOrderType.DELIVERY,
  PosOrderType.QUICK_SALE,
];

function isOrderType(value: string | null): value is PosOrderType {
  return value !== null && (ORDER_TYPES as string[]).includes(value);
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

function lineKey(): string {
  return `line-${crypto.randomUUID()}`;
}

export function PosMargEntryPage(): JSX.Element {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { hasCapability } = useAuth();
  const canOperate = hasCapability(Capability.POS_OPERATE);
  const canCheckout = hasCapability(Capability.POS_CHECKOUT);

  const orderId = params.get('orderId');
  const wantsCheckout = params.get('checkout') === '1';

  const urlType = params.get('type');
  const initialType = isOrderType(urlType) ? urlType : PosOrderType.TAKEAWAY;
  const [menuCode, setMenuCode] = useState('');
  const [orderType, setOrderType] = useState<PosOrderType>(initialType);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [billNo, setBillNo] = useState('');
  const [party, setParty] = useState('');
  const [notes, setNotes] = useState('');
  const [lookupOpen, setLookupOpen] = useState(false);
  const [lookup, setLookup] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checkoutOrder, setCheckoutOrder] = useState<PosOrderDetailDto | null>(null);

  const { data: loadedOrder } = usePosOrder(orderId);
  const createOrder = useCreatePosOrder();
  const updateOrder = useUpdatePosOrder();
  const setStatus = useSetPosOrderStatus();
  const busy = createOrder.isPending || updateOrder.isPending || setStatus.isPending;

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
    if (menuCode !== '' || publishedMenus.length === 0) return;
    if (loadedOrder !== undefined && loadedOrder.menuId !== null) {
      const own = publishedMenus.find((menu) => menu.id === loadedOrder.menuId);
      if (own !== undefined) setMenuCode(own.code);
      return;
    }
    const first = publishedMenus[0];
    if (first !== undefined) setMenuCode(first.code);
  }, [menuCode, publishedMenus, loadedOrder]);

  useEffect(() => {
    if (loadedOrder === undefined) return;
    setOrderType(loadedOrder.orderType);
    setBillNo(loadedOrder.orderNumber);
    setParty(loadedOrder.entityName ?? '');
    setNotes(loadedOrder.notes ?? '');
    setLines(
      loadedOrder.items
        .filter((item) => item.status === PosOrderItemStatus.ACTIVE)
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map<CartLine>((item) => ({
          key: lineKey(),
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          customItemName: item.customItemName,
          name: item.itemName,
          variantName: item.variantName,
          unit: item.unit,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          freeQty: 0,
          pack: '',
          batch: '',
          allowDecimalQuantity: item.allowDecimalQuantity,
          discountType: item.discountType,
          discountValue: item.discountValue,
          notes: item.notes,
        })),
    );
  }, [loadedOrder]);

  const today = useMemo(() => new Date().toLocaleDateString('en-IN'), []);

  const allSellables = useMemo(() => {
    const list: { item: ResolvedMenuItemDto; variant: ResolvedMenuVariantDto | null }[] = [];
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

  const filteredSellables = useMemo(() => {
    const q = lookup.trim().toLowerCase();
    if (q === '') return allSellables;
    return allSellables.filter(({ item, variant }) => {
      const hay = `${item.name} ${variant?.name ?? ''} ${item.unit}`.toLowerCase();
      return hay.includes(q);
    });
  }, [allSellables, lookup]);

  const addLine = useCallback(
    (item: ResolvedMenuItemDto, variant: ResolvedMenuVariantDto | null) => {
      const price = variant?.price ?? item.basePrice ?? 0;
      setLines((rows) => [
        ...rows,
        {
          key: lineKey(),
          menuItemId: item.foodItemId,
          variantId: variant?.id ?? null,
          customItemName: null,
          name: item.name,
          variantName: variant?.name ?? null,
          unit: variant?.unit ?? item.unit ?? 'NOS',
          unitPrice: price,
          quantity: 1,
          freeQty: 0,
          pack: '',
          batch: '',
          allowDecimalQuantity: variant?.allowDecimalQuantity ?? item.allowDecimalQuantity ?? false,
          discountType: PosDiscountType.NONE,
          discountValue: 0,
          notes: null,
        },
      ]);
      setLookupOpen(false);
      setLookup('');
    },
    [],
  );

  const addCustomLine = useCallback(() => {
    setLines((rows) => [
      ...rows,
      {
        key: lineKey(),
        menuItemId: null,
        variantId: null,
        customItemName: 'Ad-hoc item',
        name: 'Ad-hoc item',
        variantName: null,
        unit: 'NOS',
        unitPrice: 0,
        quantity: 1,
        freeQty: 0,
        pack: '',
        batch: '',
        allowDecimalQuantity: false,
        discountType: PosDiscountType.NONE,
        discountValue: 0,
        notes: null,
      },
    ]);
  }, []);

  const updateLine = useCallback((key: string, patch: Partial<CartLine>) => {
    setLines((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((rows) => rows.filter((row) => row.key !== key));
  }, []);

  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + lineGross(line), 0), [lines]);
  const discount = useMemo(() => lines.reduce((sum, line) => sum + lineDiscount(line), 0), [lines]);
  const net = useMemo(() => subtotal - discount, [subtotal, discount]);

  const itemsPayload = useCallback((): PosOrderItemInput[] => {
    return lines.map((line, index) => ({
      menuItemId: line.menuItemId,
      variantId: line.variantId,
      customItemName: line.customItemName,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      unit: line.unit,
      discountType: line.discountType,
      discountValue: line.discountValue,
      notes: line.notes,
      sortOrder: index,
    }));
  }, [lines]);

  const persist = useCallback(
    async (status: PosOrderStatus): Promise<PosOrderDetailDto | null> => {
      setError(null);
      const quickSale = orderType === PosOrderType.QUICK_SALE;
      try {
        let result: PosOrderDetailDto;
        const header = {
          orderType,
          menuId,
          entityId: quickSale ? null : null,
          entityName: quickSale ? null : party.trim() || null,
          entityPhone: null,
          entityAddress: null,
          tableLabel: null,
          pax: 0,
          scheduledFor: null,
          notes: notes.trim() || null,
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
        setError(readError(err).message);
        return null;
      }
    },
    [orderType, menuId, party, notes, loadedOrder, itemsPayload, createOrder, updateOrder, setStatus],
  );

  useEffect(() => {
    if (!wantsCheckout || loadedOrder === undefined || !canCheckout) return;
    if (
      loadedOrder.status !== PosOrderStatus.OPEN ||
      (PosOrderStatus.OPEN as string) === loadedOrder.status
    ) {
      setCheckoutOrder(loadedOrder);
    }
  }, [wantsCheckout, loadedOrder, canCheckout]);

  const handleCheckout = useCallback(async () => {
    if (loadedOrder === undefined) {
      const placed = await persist(PosOrderStatus.OPEN);
      if (placed !== null) setCheckoutOrder(placed);
      return;
    }
    if (loadedOrder.status === PosOrderStatus.OPEN) {
      setCheckoutOrder(loadedOrder);
    } else {
      const placed = await persist(PosOrderStatus.OPEN);
      if (placed !== null) setCheckoutOrder(placed);
    }
  }, [loadedOrder, persist]);

  const handleSave = useCallback(async () => {
    await persist(PosOrderStatus.DRAFT);
  }, [persist]);

  const handlePlace = useCallback(async () => {
    const placed = await persist(PosOrderStatus.OPEN);
    if (placed !== null) {
      navigate(`/pos/marg?orderId=${placed.id}`, { replace: true });
    }
  }, [persist, navigate]);

  const renderLookup = () => (
    <Dialog open={lookupOpen} onOpenChange={setLookupOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Item lookup</DialogTitle>
        </DialogHeader>
        <Command>
          <CommandInput
            placeholder="Type item name or code…"
            value={lookup}
            onValueChange={setLookup}
          />
          <CommandList>
            <CommandEmpty>No item found.</CommandEmpty>
            <CommandGroup>
              {filteredSellables.map(({ item, variant }) => {
                const price = variant?.price ?? item.basePrice ?? 0;
                const label = variant !== null ? `${item.name} · ${variant.name}` : item.name;
                return (
                  <CommandItem
                    key={`${item.foodItemId}-${variant?.id ?? 'base'}`}
                    value={`${item.foodItemId}-${variant?.id ?? 'base'}`}
                    onSelect={() => addLine(item, variant)}
                  >
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                      {formatMoney(price)}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );

  return (
    /* `h-dvh`, not `h-screen`: on a tablet browser `vh` ignores the retracting address bar, so
       the footer actions sat below the fold on the one screen that must always reach them. */
    <div className="bg-background flex h-dvh w-full flex-col overflow-hidden">
      {/* Keyboard-driven sale entry. The dense grid layout is the point; the colours are the
          portal's own tokens, so it reads as this product in all three skins rather than as a
          separate application pasted in. */}
      <header className="bg-card shrink-0 border-b">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back to Point of Sale"
              onClick={() => navigate('/pos')}
            >
              <ArrowLeftIcon />
            </Button>
            <h1 className="font-heading truncate text-[0.9375rem] font-semibold tracking-[-0.014em]">
              Sale entry
            </h1>
          </div>
          <dl className="text-muted-foreground flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <dt>Date</dt>
              <dd className="text-foreground font-medium tabular-nums">{today}</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <dt>Bill no.</dt>
              <dd className="text-foreground font-medium tabular-nums">{billNo || 'New'}</dd>
            </div>
          </dl>
        </div>

        {/* Wraps rather than overflows: on a narrow till these three controls stack instead of
            pushing the party field off the edge. */}
        <div className="bg-muted/40 flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-3 py-2">
          <div className="flex items-center gap-2">
            <label htmlFor="marg-type" className="text-muted-foreground text-xs font-medium">
              Type
            </label>
            <SelectField
              id="marg-type"
              value={orderType}
              onChange={(value) => setOrderType(value as PosOrderType)}
              options={ORDER_TYPES.map((type) => ({ value: type, label: ORDER_TYPE_LABEL[type] }))}
              triggerClassName="min-w-[8rem]"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="marg-menu" className="text-muted-foreground text-xs font-medium">
              Menu
            </label>
            <SelectField
              id="marg-menu"
              value={menuCode}
              onChange={(value) => setMenuCode(value)}
              options={publishedMenus.map((menu) => ({ value: menu.code, label: menu.name }))}
              placeholder="Select menu…"
              triggerClassName="min-w-[10rem]"
            />
          </div>
          <div className="flex min-w-[12rem] flex-1 items-center gap-2">
            <label htmlFor="marg-party" className="text-muted-foreground text-xs font-medium">
              Party
            </label>
            <Input
              id="marg-party"
              value={party}
              onChange={(event) => setParty(event.target.value)}
              placeholder="Walk-in / name"
            />
          </div>
        </div>
      </header>

      {/* Toolbar */}
      <div className="bg-muted/60 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setLookupOpen(true)}
          disabled={!canOperate || menuCode === ''}
        >
          <SearchIcon data-icon="inline-start" />
          Lookup
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustomLine}
          disabled={!canOperate}
        >
          <PlusIcon data-icon="inline-start" />
          Custom
        </Button>
        {treeLoading && <Spinner className="text-muted-foreground" />}
        <div className="flex-1" />
        {/* `role="alert"` so the failure is announced, not just tinted. */}
        {error !== null && (
          <span role="alert" className="text-destructive text-sm font-medium">
            {error}
          </span>
        )}
      </div>

      {/* Grid. Horizontal scroll lives here so the nine columns never squeeze into an
          unreadable width on a narrow till; the header stays put while the lines scroll. */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <thead className="bg-muted text-muted-foreground sticky top-0 z-10">
            <tr className="[&>th]:border-border [&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:text-xs [&>th]:font-medium [&>th]:tracking-[0.04em] [&>th]:uppercase">
              <th className="text-left">Product</th>
              <th className="w-24 text-left">Pack</th>
              <th className="w-24 text-left">Batch</th>
              <th className="w-20 text-right">Qty</th>
              <th className="w-16 text-right">Free</th>
              <th className="w-24 text-right">Rate</th>
              <th className="w-16 text-right">Dis%</th>
              <th className="w-28 text-right">Amount</th>
              <th className="w-10">
                <span className="sr-only">Remove line</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr
                key={line.key}
                className="border-border hover:bg-muted/40 border-b transition-colors [&>td]:px-1.5 [&>td]:py-1 [&>td]:align-top"
              >
                <td className="!px-2">
                  <div className="flex flex-col">
                    <span className="font-medium">{line.name}</span>
                    {line.variantName !== null && (
                      <span className="text-muted-foreground text-xs">{line.variantName}</span>
                    )}
                    {line.customItemName !== null && (
                      <Badge variant="outline" className="mt-0.5 w-fit text-[0.625rem]">
                        Ad-hoc
                      </Badge>
                    )}
                  </div>
                </td>
                <td>
                  <Input
                    value={line.pack}
                    onChange={(event) => updateLine(line.key, { pack: event.target.value })}
                    className="h-8 px-1.5 text-sm"
                    disabled={!canOperate}
                  />
                </td>
                <td>
                  <Input
                    value={line.batch}
                    onChange={(event) => updateLine(line.key, { batch: event.target.value })}
                    className="h-8 px-1.5 text-sm"
                    disabled={!canOperate}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min={0.001}
                    step={line.allowDecimalQuantity ? 0.001 : 1}
                    value={line.quantity}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value > 0) {
                        updateLine(line.key, {
                          quantity: line.allowDecimalQuantity
                            ? Math.round(value * 1000) / 1000
                            : Math.round(value),
                        });
                      }
                    }}
                    className="h-8 px-1.5 text-right text-sm tabular-nums"
                    disabled={!canOperate}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={line.freeQty}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 0) {
                        updateLine(line.key, { freeQty: Math.round(value) });
                      }
                    }}
                    className="h-8 px-1.5 text-right text-sm tabular-nums"
                    disabled={!canOperate}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min={0}
                    step={0.01}
                    value={line.unitPrice}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value) && value >= 0) {
                        updateLine(line.key, { unitPrice: Math.round(value * 100) / 100 });
                      }
                    }}
                    className="h-8 px-1.5 text-right text-sm tabular-nums"
                    disabled={!canOperate}
                  />
                </td>
                <td>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={line.discountValue}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      updateLine(line.key, {
                        discountType: PosDiscountType.PERCENT,
                        discountValue: Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0,
                      });
                    }}
                    className="h-8 px-1.5 text-right text-sm tabular-nums"
                    disabled={!canOperate}
                  />
                </td>
                <td className="!px-2 text-right tabular-nums">
                  {formatMoney(lineNet(line))}
                </td>
                <td>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => removeLine(line.key)}
                    disabled={!canOperate}
                  >
                    <Trash2Icon />
                  </Button>
                </td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    variant="empty"
                    title="No lines yet"
                    description={
                      menuCode === ''
                        ? 'Choose a menu above, then press Lookup to add the first item.'
                        : 'Press Lookup to find an item, or Custom to bill something off-menu.'
                    }
                    {...(canOperate && menuCode !== ''
                      ? { action: { label: 'Lookup', onClick: () => setLookupOpen(true) } }
                      : {})}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Note and totals. Stacks below the lines on a narrow till rather than squeezing the
          totals into a third of a phone's width. */}
      <div className="bg-muted/40 grid shrink-0 grid-cols-1 border-t text-sm md:grid-cols-3">
        <div className="border-b p-3 md:col-span-2 md:border-r md:border-b-0">
          <TextField
            label="Ticket note"
            multiline
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={LIMITS.POS_ORDER_NOTES_MAX}
            disabled={!canOperate}
          />
        </div>
        <dl className="flex flex-col gap-1 p-3">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Value of goods</dt>
            <dd className="tabular-nums">{formatMoney(subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Discount</dt>
            <dd className="tabular-nums">{formatMoney(discount)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">GST</dt>
            <dd className="tabular-nums">—</dd>
          </div>
          <div className="mt-1 flex justify-between gap-4 border-t pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatMoney(net)}</dd>
          </div>
        </dl>
      </div>

      {/* Footer actions */}
      <div className="bg-card flex shrink-0 flex-wrap items-center gap-2 border-t px-3 py-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleSave}
          disabled={!canOperate || lines.length === 0 || busy}
        >
          Save draft
        </Button>
        <Button
          type="button"
          onClick={handlePlace}
          disabled={!canOperate || lines.length === 0 || busy}
        >
          Place
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          variant="secondary"
          onClick={handleCheckout}
          disabled={!canCheckout || lines.length === 0 || busy}
        >
          <CalculatorIcon data-icon="inline-start" />
          Checkout
        </Button>
      </div>

      {renderLookup()}

      {checkoutOrder !== null && (
        <PosCheckoutModal
          open
          order={checkoutOrder}
          onClose={() => setCheckoutOrder(null)}
          onSettled={(settledOrder) => {
            setCheckoutOrder(null);
            if (settledOrder.orderType === PosOrderType.QUICK_SALE) {
              navigate('/pos/marg?type=QUICK_SALE', { replace: true });
            } else {
              navigate('/pos', { replace: true });
            }
          }}
        />
      )}
    </div>
  );
}
