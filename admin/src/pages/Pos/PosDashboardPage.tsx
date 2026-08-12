import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Capability,
  LIMITS,
  PosOrderStatus,
  PosOrderType,
  type PosOrderDto,
} from '@menuboard/shared';
import {
  ArmchairIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BikeIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  ContactRoundIcon,
  FilePenIcon,
  GripVerticalIcon,
  HandCoinsIcon,
  KeyboardIcon,
  SettingsIcon,
  ShoppingBagIcon,
  UtensilsIcon,
  WalletIcon,
  ZapIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BackButton } from '@/components/BackButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { CardGridSkeleton, StatGridSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/spinner';
import { StatTile } from '@/components/ui/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TextField } from '@/components/form/fields';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDeviceProfile } from '@/hooks/useDeviceProfile';
import { usePosDashboard, usePosOrders, useSetPosOrderStatus, useVoidPosOrder } from '@/hooks/usePos';
import { useAuth } from '@/services/AuthContext';
import { IfCapable } from '@/services/CapabilityGate';
import { notify } from '@/lib/notify';
import {
  TONE_BG_CLASS,
  TONE_CHIP_CLASS,
  TONE_DOT_CLASS,
  TONE_TEXT_CLASS,
  type StatusToneName,
} from '@/lib/tones';
import { DataTable, type DataTableColumn } from '@/components/DataTable/DataTable';
import { cn } from '@/lib/utils';
import { PosOrderCard } from './PosOrderCard';
import { formatMoney } from './posFormat';

type SectionKey = 'drafts' | 'scheduled' | 'takeaway' | 'named' | 'open';
/** A movable block on the dashboard. Today's sales is one, so it can be ordered with the rest. */
type BlockKey = SectionKey | 'sales';

const DEFAULT_BLOCK_ORDER: BlockKey[] = [
  'drafts',
  'scheduled',
  'takeaway',
  'named',
  'open',
  'sales',
];

const BLOCK_LABEL: Record<BlockKey, string> = {
  drafts: 'Drafts',
  scheduled: 'Scheduled',
  takeaway: 'Takeaway',
  named: 'Named',
  open: 'Open',
  sales: "Today's sales",
};

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

/** Tolerates a stored order written before a block existed, or after one was removed. */
function parseBlockOrder(raw: string): BlockKey[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return DEFAULT_BLOCK_ORDER;
  const known = parsed.filter((key): key is BlockKey =>
    DEFAULT_BLOCK_ORDER.includes(key as BlockKey),
  );
  const deduped = [...new Set(known)];
  return [...deduped, ...DEFAULT_BLOCK_ORDER.filter((key) => !deduped.includes(key))];
}



interface SectionSpec {
  key: SectionKey;
  title: string;
  description: string;
  orders: PosOrderDto[];
  tone: StatusToneName;
  icon: ReactNode;
  /** Says what would put a ticket here, rather than only that there is none. */
  emptyText: string;
}

interface CardActions {
  onOpen: (order: PosOrderDto) => void;
  onCheckout?: (order: PosOrderDto) => void;
  onCancel?: (order: PosOrderDto) => void;
  onVoid?: (order: PosOrderDto) => void;
}

const NEW_SALE = {
  takeaway: { type: PosOrderType.TAKEAWAY, label: 'New takeaway', icon: <ShoppingBagIcon /> },
  dineIn: { type: PosOrderType.DINE_IN, label: 'New dine-in', icon: <ArmchairIcon /> },
  delivery: { type: PosOrderType.DELIVERY, label: 'New delivery', icon: <BikeIcon /> },
  quickSale: { type: PosOrderType.QUICK_SALE, label: 'Quick sale', icon: <ZapIcon /> },
} as const;

/**
 * The counter's home screen.
 *
 * Five windows, one per reason a ticket is still on the floor, because "everything open"
 * sorted by time is exactly the view that lets a parked draft or a forward-dated order go
 * unnoticed until a customer asks. Desktop stacks all five — a counter terminal has the room
 * and switching costs attention. A phone gets tabs instead, since five stacked windows there
 * is a scroll long enough that the last one may as well not exist.
 */
export function PosDashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const { hasCapability } = useAuth();
  const { isMobile, prefersReducedMotion } = useDeviceProfile();
  const { data, isLoading, isFetching } = usePosDashboard();
  const setStatus = useSetPosOrderStatus();
  const voidSale = useVoidPosOrder();

  const [activeSection, setActiveSection] = useState<SectionKey>('open');
  const [pending, setPending] = useState<{ kind: 'cancel' | 'void'; order: PosOrderDto } | null>(
    null,
  );

  /* Display preferences. All persisted: a counter terminal is set up once and then used, so a
     layout that resets on reload is a layout the operator has to fix every shift. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cardSize, setCardSize] = useState(() =>
    readStored('pos-dash-card-size', 5, (raw) =>
      Math.min(10, Math.max(MIN_CARD_SIZE, Number(raw))),
    ),
  );

  const [grouped, setGrouped] = useState(() =>
    readStored('pos-dash-grouped', true, (raw) => raw !== 'false'),
  );
  const [blockOrder, setBlockOrder] = useState<BlockKey[]>(() =>
    readStored('pos-dash-block-order', DEFAULT_BLOCK_ORDER, parseBlockOrder),
  );
  const [dragKey, setDragKey] = useState<BlockKey | null>(null);
  const [dropKey, setDropKey] = useState<BlockKey | null>(null);

  useEffect(() => {
    localStorage.setItem('pos-dash-card-size', String(cardSize));
  }, [cardSize]);
  useEffect(() => {
    localStorage.setItem('pos-dash-grouped', String(grouped));
  }, [grouped]);
  useEffect(() => {
    localStorage.setItem('pos-dash-block-order', JSON.stringify(blockOrder));
  }, [blockOrder]);

  function moveBlock(key: BlockKey, delta: number): void {
    setBlockOrder((order) => {
      const index = order.indexOf(key);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= order.length) return order;
      const next = [...order];
      [next[index], next[target]] = [next[target] as BlockKey, next[index] as BlockKey];
      return next;
    });
  }

  /** Lifts `from` out of the order and drops it where `to` currently sits. */
  function reorderBlock(from: BlockKey, to: BlockKey): void {
    if (from === to) return;
    setBlockOrder((order) => {
      const next = order.filter((entry) => entry !== from);
      const at = next.indexOf(to);
      if (at === -1) return order;
      next.splice(at, 0, from);
      return next;
    });
  }

  // One flow renders exactly two things — the merged ticket grid and today's sales — so the
  // settings list shows those two rather than five buckets that are not on the page.
  const salesFirst = blockOrder[0] === 'sales';
  const flowKey = (blockOrder.find((key) => key !== 'sales') ?? 'open') as BlockKey;
  const orderRows: BlockKey[] = grouped
    ? blockOrder
    : salesFirst
      ? ['sales', flowKey]
      : [flowKey, 'sales'];

  function rowLabel(key: BlockKey): string {
    return !grouped && key !== 'sales' ? 'All tickets' : BLOCK_LABEL[key];
  }

  function setSalesFirst(first: boolean): void {
    setBlockOrder((order) => {
      const rest = order.filter((key) => key !== 'sales');
      return first ? ['sales', ...rest] : [...rest.slice(0, 1), 'sales', ...rest.slice(1)];
    });
  }

  function moveRow(key: BlockKey, delta: number): void {
    if (grouped) {
      moveBlock(key, delta);
      return;
    }
    setSalesFirst(key === 'sales' ? delta < 0 : delta > 0);
  }

  function reorderRow(from: BlockKey, to: BlockKey): void {
    if (from === to) return;
    if (grouped) {
      reorderBlock(from, to);
      return;
    }
    setSalesFirst(from === 'sales');
  }
  const [reason, setReason] = useState('');
  const windows = useRef(new Map<SectionKey, HTMLElement | null>());
  // Survives clearing `pending`, so the wording stays put through the closing animation
  // instead of blanking out mid-fade.
  const lastAsked = useRef<{ kind: 'cancel' | 'void'; order: PosOrderDto } | null>(null);

  function startSale(type: PosOrderType): void {
    navigate(`/pos/entry?type=${type}`);
  }

  function startMargSale(type: PosOrderType): void {
    navigate(`/pos/marg?type=${type}`);
  }

  function focusSection(key: SectionKey): void {
    setActiveSection(key);
    windows.current.get(key)?.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  function askReason(kind: 'cancel' | 'void', order: PosOrderDto): void {
    setReason('');
    lastAsked.current = { kind, order };
    setPending({ kind, order });
  }

  const working = setStatus.isPending || voidSale.isPending;
  const asked = pending ?? lastAsked.current;
  const isVoid = asked?.kind === 'void';
  const trimmedReason = reason.trim();

  async function submitReason(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (pending === null) return;
    if (pending.kind === 'void' && trimmedReason === '') return;

    try {
      if (pending.kind === 'cancel') {
        await setStatus.mutateAsync({
          id: pending.order.id,
          body: {
            status: PosOrderStatus.CANCELLED,
            reason: trimmedReason === '' ? null : trimmedReason,
          },
        });
        notify.success(`Ticket ${pending.order.orderNumber} cancelled.`);
      } else {
        await voidSale.mutateAsync({
          id: pending.order.id,
          body: { reason: trimmedReason },
        });
        notify.success(`Sale ${pending.order.orderNumber} voided.`);
      }
      setPending(null);
    } catch (err) {
      notify.fromError(err);
    }
  }

  const actions: CardActions = {
    onOpen: (order) => navigate(`/pos/entry?orderId=${order.id}`),
    ...(hasCapability(Capability.POS_CHECKOUT)
      ? { onCheckout: (order: PosOrderDto) => navigate(`/pos/entry?orderId=${order.id}&checkout=1`) }
      : {}),
    ...(hasCapability(Capability.POS_OPERATE)
      ? { onCancel: (order: PosOrderDto) => askReason('cancel', order) }
      : {}),
    ...(hasCapability(Capability.POS_VOID)
      ? { onVoid: (order: PosOrderDto) => askReason('void', order) }
      : {}),
  };

  const newSaleActions = (
    <IfCapable capability={Capability.POS_OPERATE}>
      <Button onClick={() => startSale(NEW_SALE.takeaway.type)}>
        {NEW_SALE.takeaway.icon}
        {NEW_SALE.takeaway.label}
      </Button>
      {/* Dine-in, delivery and the keyboard-entry screen are the rarer starts, and five
          buttons across a phone leaves none of them tappable, so on a narrow screen they
          fold into one menu. */}
      {isMobile ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              More
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={() => startSale(NEW_SALE.dineIn.type)}>
              {NEW_SALE.dineIn.icon}
              {NEW_SALE.dineIn.label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startSale(NEW_SALE.delivery.type)}>
              {NEW_SALE.delivery.icon}
              {NEW_SALE.delivery.label}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startMargSale(NEW_SALE.takeaway.type)}>
              <KeyboardIcon />
              MARG entry
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <>
          <Button variant="outline" onClick={() => startSale(NEW_SALE.dineIn.type)}>
            {NEW_SALE.dineIn.icon}
            {NEW_SALE.dineIn.label}
          </Button>
          <Button variant="outline" onClick={() => startSale(NEW_SALE.delivery.type)}>
            {NEW_SALE.delivery.icon}
            {NEW_SALE.delivery.label}
          </Button>
        </>
      )}
      <Button variant="outline" onClick={() => startSale(NEW_SALE.quickSale.type)}>
        {NEW_SALE.quickSale.icon}
        {NEW_SALE.quickSale.label}
      </Button>
      {/* Same weight and shape as its neighbours — it used to be the one solid `secondary`
          button in the row, which read as the primary action rather than an alternative. */}
      {!isMobile && (
        <Button
          variant="outline"
          onClick={() => startMargSale(NEW_SALE.takeaway.type)}
          aria-label="New takeaway in MARG keyboard entry"
        >
          <KeyboardIcon />
          MARG entry
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Display settings"
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon />
      </Button>
    </IfCapable>
  );

  if (isLoading || !data) {
    return (
      <>
        <PageHeader
          leading={<BackButton to="/" label="Back to Dashboard" />}
          title="Point of Sale"
          actions={newSaleActions}
        />
        <div className="flex flex-col gap-6">
          <StatGridSkeleton count={8} />
          <CardGridSkeleton count={8} />
        </div>
      </>
    );
  }

  const { summary } = data;

  const allSections: SectionSpec[] = [
    {
      key: 'drafts',
      title: 'Drafts',
      description: 'Parked mid-entry. Nothing is committed until a draft is opened.',
      orders: data.drafts,
      tone: 'muted',
      icon: <FilePenIcon />,
      emptyText: 'Nothing parked. Every ticket started today was finished.',
    },
    {
      key: 'scheduled',
      title: 'Scheduled',
      description: 'Finished tickets dated forward. They appear here until their time comes.',
      orders: data.scheduled,
      tone: 'progress',
      icon: <CalendarClockIcon />,
      emptyText: 'Nothing is dated forward. Schedule a ticket to hold it for a later service.',
    },
    {
      key: 'takeaway',
      title: 'Takeaway',
      description: 'Packed to leave the counter. Settle each one before the bag does.',
      orders: data.takeaway,
      tone: 'info',
      icon: <ShoppingBagIcon />,
      emptyText: 'No takeaway waiting to be collected.',
    },
    {
      key: 'named',
      title: 'Named',
      description: 'Raised in the name of a customer, employee or vendor.',
      orders: data.named,
      tone: 'neutral',
      icon: <ContactRoundIcon />,
      emptyText: 'Nothing billed to a name yet — every sale today has been a walk-in.',
    },
    {
      key: 'open',
      title: 'Open',
      description: 'On the floor and unsettled. Every ticket here is money still owed.',
      orders: data.open,
      tone: 'success',
      icon: <UtensilsIcon />,
      emptyText: 'Nothing open. The floor is clear.',
    },
  ];
  const sections = allSections.filter(
    (section) => section.key === 'takeaway' || section.orders.length > 0,
  );
  const sectionByKey = new Map(sections.map((section) => [section.key, section]));

  /* Flow view: every ticket in one grid. The buckets overlap by design — a takeaway can also be
     open and named — so a ticket is shown once, in the order the buckets are arranged. */
  const flowOrders: PosOrderDto[] = [];
  const seenOrders = new Set<string>();
  for (const key of blockOrder) {
    for (const order of sectionByKey.get(key as SectionKey)?.orders ?? []) {
      if (seenOrders.has(order.id)) continue;
      seenOrders.add(order.id);
      flowOrders.push(order);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Counter"
        leading={<BackButton to="/" label="Back to Dashboard" />}
        title="Point of Sale"
        meta={
          isFetching ? (
            <span
              role="status"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 whitespace-nowrap',
                'text-[0.7188rem] leading-none font-semibold tracking-[0.01em]',
                TONE_CHIP_CLASS.success,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'size-[5px] shrink-0 rounded-full motion-safe:animate-pulse',
                  TONE_DOT_CLASS.success,
                )}
              />
              Live
            </span>
          ) : null
        }
        actions={newSaleActions}
      />

      <div className="flex flex-col gap-6">
        <TooltipProvider>
          {/* Fits the viewport at every width — no sideways scroll. Eight tiles wrap down to
              four, then two, then one as the window narrows. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8">
            <div className="contents">
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Drafts"
                    value={summary.draftCount}
                    hint="Parked mid-entry"
                    tone="muted"
                    icon={<FilePenIcon />}
                    onClick={() => focusSection('drafts')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Tickets saved but not yet opened for service.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Scheduled"
                    value={summary.scheduledCount}
                    hint="Dated forward"
                    tone="progress"
                    icon={<CalendarClockIcon />}
                    onClick={() => focusSection('scheduled')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Forward-dated orders waiting for their service time.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Open"
                    value={summary.openCount}
                    hint="On the floor now"
                    tone="success"
                    icon={<UtensilsIcon />}
                    onClick={() => focusSection('open')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Tickets being served and still unsettled.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Named"
                    value={summary.namedCount}
                    hint="Billed to an entity"
                    tone="neutral"
                    icon={<ContactRoundIcon />}
                    onClick={() => focusSection('named')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Sales billed to a customer, employee or vendor.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Takeaway"
                    value={summary.takeawayCount}
                    hint={`${summary.dineInCount} dine-in · ${summary.deliveryCount} delivery · ${summary.quickSaleCount} quick`}
                    tone="info"
                    icon={<ShoppingBagIcon />}
                    onClick={() => focusSection('takeaway')}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>All packed orders: takeaway, dine-in, delivery and quick sales.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Sales today"
                    value={formatMoney(summary.salesToday)}
                    hint="Settled, net of reversals"
                    tone="success"
                    icon={<HandCoinsIcon />}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Completed and settled today, most recent first.</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Outstanding"
                    value={formatMoney(summary.outstandingAmount)}
                    hint={
                      summary.outstandingAmount > 0
                        ? 'Still owed on active tickets'
                        : 'Everything is settled'
                    }
                    tone={summary.outstandingAmount > 0 ? 'danger' : 'success'}
                    emphasis={summary.outstandingAmount > 0}
                    icon={<WalletIcon />}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {summary.outstandingAmount > 0
                  ? 'Money still owed on active tickets.'
                  : 'All tickets today are fully settled.'}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatTile
                    label="Completed today"
                    value={summary.completedToday}
                    hint={`${summary.cancelledToday} cancelled`}
                    tone="success"
                    icon={<CircleCheckBigIcon />}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>Tickets finished today, including voids and cancellations.</TooltipContent>
            </Tooltip>
            </div>
          </div>
        </TooltipProvider>
      </div>

      {isMobile ? (
        <>
          <Tabs
            value={activeSection}
            onValueChange={(next) => setActiveSection(next as SectionKey)}
          >
            <TabsList className="w-full">
              {sections.map((section) => (
                <TabsTrigger key={section.key} value={section.key} className="min-w-0 text-xs">
                  <span className="truncate">{section.title}</span>
                  {section.orders.length > 0 && (
                    <span className="tabular-nums">{section.orders.length}</span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
            {sections.map((section) => (
              <TabsContent key={section.key} value={section.key}>
                <OrderWindow section={section} actions={actions} cardSize={cardSize} />
              </TabsContent>
            ))}
          </Tabs>
          <TodaysSalesSection businessDate={summary.businessDate} />
        </>
      ) : blockOrder[0] === 'sales' ? (
        <>
          <TodaysSalesSection businessDate={summary.businessDate} />
          <Card className="gap-3">
            <CardHeader className="gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>All tickets</CardTitle>
                <Badge variant="outline" className="tabular-nums">
                  {flowOrders.length}
                </Badge>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <CardDescription className="cursor-help">All tickets in one flow.</CardDescription>
                </TooltipTrigger>
                <TooltipContent>
                  Drafts, scheduled, takeaway, named and open in one flow. Each ticket appears once.
                </TooltipContent>
              </Tooltip>
            </CardHeader>
            <CardContent>
              {flowOrders.length === 0 ? (
                <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-6 text-center text-sm">
                  Nothing on the counter. The floor is clear.
                </p>
              ) : (
                <div
                  className="grid gap-3"
                  style={{
                    gridTemplateColumns: `repeat(auto-fill, minmax(${cardTrack(cardSize)}, 1fr))`,
                  }}
                >
                  {flowOrders.map((order) => (
                    <PosOrderCard key={order.id} order={order} {...actions} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : grouped ? (
        blockOrder.map((key) => {
          if (key === 'sales') {
            return <TodaysSalesSection key={key} businessDate={summary.businessDate} />;
          }
          const section = sectionByKey.get(key as SectionKey);
          if (section === undefined) return null;
          return (
            <section
              key={key}
              ref={(node) => {
                windows.current.set(section.key, node);
              }}
            >
              <OrderWindow
                section={section}
                actions={actions}
                cardSize={cardSize}
                highlighted={activeSection === section.key}
              />
            </section>
          );
        })
      ) : null}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Counter display</DialogTitle>
            <DialogDescription>
              How the tickets are laid out on this terminal. Saved on this device.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="pos-dash-card-size" className="text-sm font-medium">
                  Card size
                </label>
                <span className="text-muted-foreground text-sm tabular-nums">{cardSize}</span>
              </div>
              <input
                id="pos-dash-card-size"
                type="range"
                min={MIN_CARD_SIZE}
                max={10}
                step={1}
                value={cardSize}
                onChange={(event) => setCardSize(Number(event.target.value))}
                className="accent-primary w-full"
              />
              <p className="text-muted-foreground text-xs">
                {MIN_CARD_SIZE} smallest, 10 largest.
              </p>
            </div>

            <div className="grid gap-2">
              <span className="text-sm font-medium">Layout</span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={grouped ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setGrouped(true)}
                >
                  Grouped
                </Button>
                <Button
                  type="button"
                  variant={grouped ? 'outline' : 'default'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setGrouped(false)}
                >
                  One flow
                </Button>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-muted-foreground cursor-help text-xs">
                    {grouped
                      ? 'One window per bucket.'
                      : 'Drafts, scheduled, takeaway, named and open in one flow. Each ticket appears once.'}
                  </p>
                </TooltipTrigger>
                <TooltipContent>
                  {grouped
                    ? 'Each bucket stays separate, in the order below.'
                    : 'All tickets merge into one grid. Duplicates are removed so each bill shows once.'}
                </TooltipContent>
              </Tooltip>
            </div>

            <div className="grid gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="w-fit cursor-help text-sm font-medium">Order</span>
                </TooltipTrigger>
                <TooltipContent>
                  {grouped
                    ? 'The order the buckets and today’s sales stack down the page.'
                    : 'One flow shows only the merged ticket grid and today’s sales — drag to choose which comes first.'}
                </TooltipContent>
              </Tooltip>
              <p className="text-muted-foreground -mt-1 text-xs">
                Drag a row to reorder, or use the arrows.
              </p>
              <ul className="flex flex-col gap-1">
                {orderRows.map((key, index) => (
                  <li
                    key={key}
                    draggable
                    onDragStart={(event) => {
                      setDragKey(key);
                      event.dataTransfer.effectAllowed = 'move';
                      // Firefox refuses to start a drag without payload on the transfer.
                      event.dataTransfer.setData('text/plain', key);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      if (dropKey !== key) setDropKey(key);
                    }}
                    onDragLeave={() => setDropKey((current) => (current === key ? null : current))}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragKey) reorderRow(dragKey, key);
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setDropKey(null);
                    }}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm transition-colors',
                      dragKey === key && 'opacity-50',
                      dropKey === key && dragKey !== key && 'border-primary bg-sidebar-accent',
                    )}
                  >
                    <GripVerticalIcon
                      aria-hidden
                      className="text-muted-foreground size-4 shrink-0 cursor-grab active:cursor-grabbing"
                    />
                    <span className="min-w-0 flex-1 truncate">{rowLabel(key)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${rowLabel(key)} up`}
                      disabled={index === 0}
                      onClick={() => moveRow(key, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Move ${rowLabel(key)} down`}
                      disabled={index === orderRows.length - 1}
                      onClick={() => moveRow(key, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBlockOrder(DEFAULT_BLOCK_ORDER)}
            >
              Reset order
            </Button>
            <Button type="button" onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next && !working) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submitReason} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>
                {isVoid
                  ? `Void sale ${asked?.order.orderNumber ?? ''}`
                  : `Cancel ticket ${asked?.order.orderNumber ?? ''}`}
              </DialogTitle>
              <DialogDescription>
                {isVoid
                  ? 'Voiding reverses a settled sale: the payments are offset and the items are cancelled. It is audited, and it cannot be undone from this screen.'
                  : 'Cancelling stops this ticket for good. Its items are cancelled and nothing further can be added to it.'}
              </DialogDescription>
            </DialogHeader>

            <TextField
              label="Reason"
              required={isVoid}
              autoFocus
              multiline
              rows={2}
              maxLength={LIMITS.POS_CANCEL_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              helperText={
                isVoid
                  ? 'Required. This is what the audit trail will show for the reversal.'
                  : 'Optional, but it is what anyone reviewing this ticket later will read.'
              }
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={working}
                onClick={() => setPending(null)}
              >
                Keep it
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={working || (isVoid && trimmedReason === '')}
              >
                {working && <Spinner data-icon="inline-start" />}
                {working ? 'Working…' : isVoid ? 'Void sale' : 'Cancel ticket'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const SALES_LIMIT_OPTIONS = [10, 25, 50, 100];

const MIN_CARD_SIZE = 3;

function cardTrack(size: number): string {
  return `${8 + size * 1.25}rem`;
}

const SALES_COLUMNS: DataTableColumn<PosOrderDto>[] = [
  {
    field: 'orderNumber',
    headerName: 'Bill #',
    width: 130,
    renderCell: (order) => <span className="font-mono">{order.orderNumber}</span>,
  },
  {
    field: 'orderType',
    headerName: 'Type',
    width: 110,
    valueGetter: (order) => order.orderType.replace(/_/g, ' '),
  },
  {
    field: 'entityName',
    headerName: 'Customer',
    width: 180,
    valueGetter: (order) => order.entityName ?? '—',
  },
  {
    field: 'itemCount',
    headerName: 'Items',
    width: 80,
    align: 'right',
    valueGetter: (order) => order.itemCount ?? 0,
  },
  {
    field: 'totalAmount',
    headerName: 'Total',
    width: 110,
    align: 'right',
    renderCell: (order) => (
      <span className="text-foreground font-medium tabular-nums">
        {formatMoney(order.totalAmount)}
      </span>
    ),
  },
  {
    field: 'completedAt',
    headerName: 'Completed',
    width: 130,
    align: 'right',
    valueGetter: (order) =>
      order.completedAt ? new Date(order.completedAt).toLocaleTimeString() : '—',
  },
];

function TodaysSalesSection({ businessDate }: { businessDate: string }): JSX.Element {
  const [limit, setLimit] = useState(10);
  const { data, isLoading } = usePosOrders({
    status: [PosOrderStatus.COMPLETED],
    dateFrom: businessDate,
    dateTo: businessDate,
    page: 1,
    pageSize: limit,
  });
  const orders = data?.items ?? [];

  return (
    <Card className="gap-3">
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4 bg-tone-success-bg text-tone-success"
            >
              <CircleCheckBigIcon />
            </span>
            <CardTitle>Today&apos;s sales</CardTitle>
            <Badge variant="outline" className="tabular-nums border-tone-success-border bg-tone-success-bg text-tone-success">
              {orders.length}
            </Badge>
          </div>
          {/* The portal's select, not a hand-styled native one — the native control ignores the
              popover tokens and renders an OS-themed list in dark mode. */}
          <Select value={String(limit)} onValueChange={(next) => setLimit(Number(next))}>
            <SelectTrigger size="sm" className="w-[7.5rem]" aria-label="How many sales to show">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_LIMIT_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  Last {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <CardDescription className="cursor-help">Completed and settled today.</CardDescription>
          </TooltipTrigger>
          <TooltipContent>Completed and settled today, most recent first.</TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        {/* The same grid every other list in the portal uses, so it sorts, resizes, reorders,
            hides columns and remembers all of it exactly like the rest of the app. */}
        <DataTable
          gridId="pos-todays-sales"
          columns={SALES_COLUMNS}
          rows={orders}
          getRowId={(order) => order.id}
          loading={isLoading}
          emptyTitle="No sales completed today"
          emptyMessage="Settled tickets appear here as they are checked out."
        />
      </CardContent>
    </Card>
  );
}

/** One titled window: what the bucket means, how many are in it, and the tickets themselves. */
function OrderWindow({
  section,
  actions,
  cardSize,
  highlighted = false,
}: {
  section: SectionSpec;
  actions: CardActions;
  cardSize: number;
  highlighted?: boolean;
}): JSX.Element {
  return (
    <Card className={cn('gap-3', highlighted && 'ring-2 ring-ring/60')}>
      <CardHeader className="gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4',
              TONE_BG_CLASS[section.tone],
              TONE_TEXT_CLASS[section.tone],
            )}
          >
            {section.icon}
          </span>
          <CardTitle>{section.title}</CardTitle>
          <Badge
            variant="outline"
            className={cn('tabular-nums', TONE_CHIP_CLASS[section.tone])}
          >
            {section.orders.length}
          </Badge>
        </div>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {section.orders.length === 0 ? (
          <p className="text-muted-foreground border-border rounded-lg border border-dashed px-3 py-6 text-center text-sm">
            {section.emptyText}
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${cardTrack(cardSize)}, 1fr))`,
            }}
          >
            {section.orders.map((order) => (
              <PosOrderCard key={order.id} order={order} {...actions} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
