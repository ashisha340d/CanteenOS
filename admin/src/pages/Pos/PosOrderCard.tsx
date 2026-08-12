import {
  PosOrderStatus,
  TERMINAL_POS_ORDER_STATUSES,
  type PosOrderDto,
} from '@menuboard/shared';
import { BanIcon, CalendarClockIcon, CreditCardIcon, EllipsisIcon, UndoDotIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { StatusChip } from '@/components/StatusChip';
import { TONE_BG_CLASS, TONE_CHIP_CLASS, TONE_TEXT_CLASS } from '@/lib/tones';
import { cn } from '@/lib/utils';
import {
  ORDER_TYPE_LABEL,
  ORDER_TYPE_TONE,
  formatMoney,
  isNamed,
  relativeTime,
  scheduleLabel,
} from './posFormat';

interface PosOrderCardProps {
  order: PosOrderDto;
  onOpen: (order: PosOrderDto) => void;
  onCheckout?: (order: PosOrderDto) => void;
  onCancel?: (order: PosOrderDto) => void;
  onVoid?: (order: PosOrderDto) => void;
}

/**
 * One ticket, dense enough that a counter reads a whole window without hovering anything.
 *
 * The token number leads because that is what gets called across the room; the total is the
 * largest thing because that is what gets said next. Everything else — who it is for, where
 * they are sitting, when it is wanted — is on the face of the card rather than a click away,
 * since the alternative at a busy till is opening every ticket to find the right one.
 */
export function PosOrderCard({
  order,
  onOpen,
  onCheckout,
  onCancel,
  onVoid,
}: PosOrderCardProps): JSX.Element {
  const named = isNamed(order);
  const isTerminal = TERMINAL_POS_ORDER_STATUSES.includes(order.status);
  const itemCount = order.itemCount ?? 0;

  const seating = [
    order.tableLabel === null ? null : `Table ${order.tableLabel}`,
    order.pax > 0 ? `${order.pax} pax` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  const canCheckout =
    onCheckout !== undefined &&
    (order.status === PosOrderStatus.OPEN || order.status === PosOrderStatus.SCHEDULED);
  const canCancel = onCancel !== undefined && !isTerminal;
  const canVoid = onVoid !== undefined && order.status === PosOrderStatus.COMPLETED;
  const hasMenu = canCancel || canVoid;

  return (
    <div
      onClick={() => onOpen(order)}
      role="button"
      tabIndex={0}
      aria-label={`Open bill ${order.orderNumber}`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(order);
        }
      }}
      className={cn(
        'bg-card border-border relative flex flex-col gap-2 rounded-xl border p-3 text-left transition-[transform,box-shadow,border-color]',
        'focus-visible:ring-ring hover:border-border-strong cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none active:translate-y-0',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-base leading-none font-bold tabular-nums tracking-[-0.02em]">
            #{order.dailySequence}
          </span>
          <span className="text-muted-foreground mt-1 truncate font-mono text-[0.6875rem]">
            {order.orderNumber}
          </span>
        </div>
        <StatusChip status={order.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge
          variant="outline"
          className={cn('text-[0.6875rem]', TONE_CHIP_CLASS[ORDER_TYPE_TONE[order.orderType]])}
        >
          {ORDER_TYPE_LABEL[order.orderType]}
        </Badge>
        {seating !== '' && <span className="text-muted-foreground text-xs">{seating}</span>}
      </div>

      <div className="min-w-0">
        {named ? (
          <>
            <p className="truncate text-sm leading-snug font-medium">
              {order.entityName ?? 'Named account'}
            </p>
            {order.entityPhone !== null && (
              <p className="text-muted-foreground truncate text-xs tabular-nums">
                {order.entityPhone}
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">Walk-in</p>
        )}
      </div>

      {/* The whole reason a scheduled ticket is on this screen is its time, so it is stated
          outright rather than left in a tooltip or a relative "in 3h". */}
      {order.status === PosOrderStatus.SCHEDULED && (
        <p
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold',
            TONE_BG_CLASS.progress,
            TONE_TEXT_CLASS.progress,
          )}
        >
          <CalendarClockIcon className="size-3.5 shrink-0" />
          {scheduleLabel(order.scheduledFor)}
        </p>
      )}

      <Separator />

      <div className="flex items-end justify-between gap-2">
        <div className="text-muted-foreground min-w-0 text-xs">
          <p className="tabular-nums">
            {itemCount} {itemCount === 1 ? 'item' : 'items'}
          </p>
          <p className="mt-0.5">{relativeTime(order.createdAt)}</p>
        </div>
        <p className="text-lg leading-none font-bold tabular-nums tracking-[-0.02em]">
          {formatMoney(order.totalAmount)}
        </p>
      </div>

      {order.status !== PosOrderStatus.DRAFT && order.balanceAmount > 0 && (
        <p className="text-muted-foreground text-xs tabular-nums">
          Balance {formatMoney(order.balanceAmount)}
        </p>
      )}

      {(canCheckout || hasMenu) && (
        <div
          className="flex items-center gap-1.5"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {canCheckout && (
            <Button
              size="sm"
              className="flex-1"
              onClick={(event) => {
                event.stopPropagation();
                onCheckout?.(order);
              }}
            >
              <CreditCardIcon data-icon="inline-start" />
              Checkout
            </Button>
          )}
          {hasMenu && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={cn(!canCheckout && 'ml-auto')}
                  aria-label={`More actions for bill ${order.orderNumber}`}
                >
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                {canCancel && (
                  <DropdownMenuItem variant="destructive" onSelect={() => onCancel?.(order)}>
                    <BanIcon />
                    Cancel
                  </DropdownMenuItem>
                )}
                {canVoid && (
                  <DropdownMenuItem variant="destructive" onSelect={() => onVoid?.(order)}>
                    <UndoDotIcon />
                    Void
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
  );
}
