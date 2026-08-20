import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type {
  CounterRouteDto,
  MenuItemDto,
  PrintingRouteDto,
} from '@menuboard/shared';
import {
  ChefHatIcon,
  GripVerticalIcon,
  LoaderCircleIcon,
  SearchIcon,
  StoreIcon,
  XIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useMenuAssignmentWorkspace,
  useMoveCounterRoute,
  useMovePrintingRoute,
} from '@/hooks/useMenuMaster';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { ItemThumbnail } from '../MenuItems/MenuItemsPage';

type AssignmentMode = 'counter' | 'kitchen';

type AssignmentRoute = CounterRouteDto | PrintingRouteDto;

interface DraggedItem {
  mode: AssignmentMode;
  itemId: string;
  sourceRouteId?: string;
  sourceTargetId?: string;
}

interface RoutedItem {
  item: MenuItemDto;
  route?: AssignmentRoute;
}

const DROP_UNASSIGNED = '__unassigned__';

export function MenuRouteAssignmentsPage({ mode }: { mode: AssignmentMode }): JSX.Element {
  const { data, isLoading, isError, refetch } = useMenuAssignmentWorkspace();
  const moveCounter = useMoveCounterRoute();
  const moveKitchen = useMovePrintingRoute();
  const [search, setSearch] = useState('');
  const [dragged, setDragged] = useState<DraggedItem | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const pending = moveCounter.isPending || moveKitchen.isPending;

  const itemsById = useMemo(
    () => new Map((data?.menuItems ?? []).map((item) => [item.id, item])),
    [data?.menuItems],
  );
  const routes = useMemo<AssignmentRoute[]>(
    () => (mode === 'counter' ? data?.counterRoutes ?? [] : data?.printingRoutes ?? []),
    [data?.counterRoutes, data?.printingRoutes, mode],
  );
  const targets = mode === 'counter' ? data?.counters ?? [] : data?.kitchens ?? [];
  const assignedIds = useMemo(() => new Set(routes.map((route) => route.entityId)), [routes]);
  const needle = search.trim().toLocaleLowerCase();
  const matches = (item: MenuItemDto) =>
    needle === '' ||
    item.name.toLocaleLowerCase().includes(needle) ||
    (item.nameHi ?? '').toLocaleLowerCase().includes(needle) ||
    (item.categoryName ?? '').toLocaleLowerCase().includes(needle);

  const unassigned = (data?.menuItems ?? [])
    .filter((item) => !assignedIds.has(item.id))
    .filter(matches)
    .map((item) => ({ item }));

  function routeTargetId(route: AssignmentRoute): string {
    return mode === 'counter'
      ? (route as CounterRouteDto).counterId
      : (route as PrintingRouteDto).printingGroupId;
  }

  function itemsForTarget(targetId: string): RoutedItem[] {
    return routes
      .filter((route) => routeTargetId(route) === targetId)
      .flatMap((route) => {
        const item = itemsById.get(route.entityId);
        return item && matches(item) ? [{ item, route }] : [];
      });
  }

  function beginDrag(event: DragEvent, item: DraggedItem): void {
    if (pending) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.itemId);
    setDragged(item);
  }

  async function moveItem(targetId?: string): Promise<void> {
    if (!dragged || pending) return;
    if (dragged.sourceTargetId === targetId || (!dragged.sourceRouteId && !targetId)) {
      setDragged(null);
      setDropTarget(null);
      return;
    }
    try {
      if (mode === 'counter') {
        await moveCounter.mutateAsync({
          entityType: 'MENU_ITEM',
          entityId: dragged.itemId,
          ...(dragged.sourceRouteId ? { sourceRouteId: dragged.sourceRouteId } : {}),
          ...(targetId ? { targetCounterId: targetId } : {}),
        });
      } else {
        await moveKitchen.mutateAsync({
          entityType: 'MENU_ITEM',
          entityId: dragged.itemId,
          ...(dragged.sourceRouteId ? { sourceRouteId: dragged.sourceRouteId } : {}),
          ...(targetId ? { targetPrintingGroupId: targetId } : {}),
        });
      }
      notify.success(targetId ? `Item assigned to ${mode}.` : `Item moved to Unassigned.`);
    } catch (error) {
      notify.fromError(error);
    } finally {
      setDragged(null);
      setDropTarget(null);
    }
  }

  function dropOn(event: DragEvent, targetId?: string): void {
    event.preventDefault();
    void moveItem(targetId);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-sm" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
        <p className="text-sm font-medium">Assignments could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const targetLabel = mode === 'counter' ? 'counter' : 'kitchen';
  const TargetIcon = mode === 'counter' ? StoreIcon : ChefHatIcon;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search menu items"
            className="pl-8"
            aria-label="Search menu items"
          />
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {pending && <LoaderCircleIcon className="size-3.5 animate-spin" />}
          <span>{data.menuItems.length} items</span>
          <span aria-hidden="true">·</span>
          <span>{targets.length} {targetLabel}{targets.length === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AssignmentColumn
          id={DROP_UNASSIGNED}
          title="Unassigned"
          count={(data.menuItems ?? []).filter((item) => !assignedIds.has(item.id)).length}
          items={unassigned}
          active={dropTarget === DROP_UNASSIGNED}
          pending={pending}
          selected={dragged}
          onDragEnter={() => setDropTarget(DROP_UNASSIGNED)}
          onDrop={(event) => dropOn(event)}
          onDragStart={beginDrag}
          onDragEnd={() => {
            setDragged(null);
            setDropTarget(null);
          }}
          onKeyboardPick={(item) => setDragged(item)}
          onKeyboardDrop={() => void moveItem()}
          onUnassign={() => undefined}
          mode={mode}
        />

        {targets.map((target) => (
          <AssignmentColumn
            key={target.id}
            id={target.id}
            title={target.name}
            subtitle={target.code ?? undefined}
            count={routes.filter((route) => routeTargetId(route) === target.id).length}
            items={itemsForTarget(target.id)}
            active={dropTarget === target.id}
            pending={pending}
            selected={dragged}
            icon={<TargetIcon className="size-4" />}
            onDragEnter={() => setDropTarget(target.id)}
            onDrop={(event) => dropOn(event, target.id)}
            onDragStart={beginDrag}
            onDragEnd={() => {
              setDragged(null);
              setDropTarget(null);
            }}
            onKeyboardPick={(item) => setDragged(item)}
            onKeyboardDrop={() => void moveItem(target.id)}
            onUnassign={async (item) => {
              setDragged(item);
              await (async () => {
                try {
                  if (mode === 'counter') {
                    await moveCounter.mutateAsync({
                      entityType: 'MENU_ITEM',
                      entityId: item.itemId,
                      ...(item.sourceRouteId ? { sourceRouteId: item.sourceRouteId } : {}),
                    });
                  } else {
                    await moveKitchen.mutateAsync({
                      entityType: 'MENU_ITEM',
                      entityId: item.itemId,
                      ...(item.sourceRouteId ? { sourceRouteId: item.sourceRouteId } : {}),
                    });
                  }
                  notify.success('Item moved to Unassigned.');
                } catch (error) {
                  notify.fromError(error);
                } finally {
                  setDragged(null);
                  setDropTarget(null);
                }
              })();
            }}
            targetId={target.id}
            mode={mode}
          />
        ))}
      </div>

      {targets.length === 0 && (
        <div className="text-muted-foreground flex min-h-24 items-center justify-center rounded-xl border border-dashed text-sm">
          Create a {targetLabel} first to begin assigning menu items.
        </div>
      )}
    </div>
  );
}

function AssignmentColumn({
  id,
  title,
  subtitle,
  count,
  items,
  active,
  pending,
  selected,
  icon,
  targetId,
  mode,
  onDragEnter,
  onDrop,
  onDragStart,
  onDragEnd,
  onKeyboardPick,
  onKeyboardDrop,
  onUnassign,
}: {
  id: string;
  title: string;
  subtitle?: string;
  count: number;
  items: RoutedItem[];
  active: boolean;
  pending: boolean;
  selected: DraggedItem | null;
  icon?: ReactNode;
  targetId?: string;
  mode?: AssignmentMode;
  onDragEnter: () => void;
  onDrop: (event: DragEvent) => void;
  onDragStart: (event: DragEvent, item: DraggedItem) => void;
  onDragEnd: () => void;
  onKeyboardPick: (item: DraggedItem) => void;
  onKeyboardDrop: () => void;
  onUnassign: (item: DraggedItem) => void | Promise<void>;
}): JSX.Element {
  return (
    <section
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        onDragEnter();
      }}
      onDrop={onDrop}
      tabIndex={selected && !pending ? 0 : -1}
      onKeyDown={(event) => {
        if (!selected || pending || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onKeyboardDrop();
      }}
      className={cn(
        'bg-card min-h-56 overflow-hidden rounded-xl border transition-[border-color,background-color,box-shadow] duration-150',
        active && 'border-primary bg-primary/5 ring-primary/20 ring-2',
      )}
      aria-label={`${title} assignment drop zone`}
      data-drop-zone={id}
    >
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-2.5">
        <span className={cn('text-muted-foreground', active && 'text-primary')}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-muted-foreground truncate text-xs">{subtitle}</p>}
        </div>
        <Badge variant="secondary" className="tabular-nums">{count}</Badge>
      </header>

      <div className="flex max-h-[calc(100vh-18rem)] min-h-44 flex-col gap-1.5 overflow-y-auto p-2">
        {items.map(({ item, route }) => {
          const routeId = route?.id;
          const dragItem: DraggedItem = {
            mode: mode ?? 'counter',
            itemId: item.id,
            ...(routeId ? { sourceRouteId: routeId } : {}),
            ...(targetId ? { sourceTargetId: targetId } : {}),
          };
          return (
            <div
              key={routeId ?? item.id}
              draggable={!pending}
              role="button"
              tabIndex={pending ? -1 : 0}
              aria-pressed={selected?.itemId === item.id && selected.sourceRouteId === dragItem.sourceRouteId}
              aria-label={`Select ${item.name} to move`}
              onKeyDown={(event) => {
                if (pending || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                onKeyboardPick(dragItem);
              }}
              onDragStart={(event) => onDragStart(event, dragItem)}
              onDragEnd={onDragEnd}
              className={cn(
                'group bg-background flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 shadow-xs transition-[border-color,box-shadow,opacity,transform] duration-150 hover:border-border-strong hover:shadow-sm active:cursor-grabbing active:scale-[0.99]',
                pending && 'pointer-events-none opacity-60',
                selected?.itemId === item.id && selected.sourceRouteId === dragItem.sourceRouteId &&
                'border-primary ring-primary/20 ring-2',
              )}
            >
              <GripVerticalIcon className="text-muted-foreground size-3.5 shrink-0" />
              <ItemThumbnail item={item} className="size-8 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="text-muted-foreground truncate text-[0.6875rem]">
                  {item.categoryName ?? item.unit}
                </p>
              </div>
              {routeId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={pending}
                  onClick={() => void onUnassign(dragItem)}
                  aria-label={`Unassign ${item.name}`}
                  className="text-muted-foreground opacity-70 group-hover:opacity-100"
                >
                  <XIcon />
                </Button>
              )}
            </div>
          );
        })}

        {items.length === 0 && (
          <div className={cn(
            'text-muted-foreground flex min-h-36 flex-1 items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs',
            active && 'border-primary/60 bg-primary/5 text-primary',
          )}>
            {active ? 'Drop menu item here' : 'No menu items'}
          </div>
        )}
      </div>
    </section>
  );
}
