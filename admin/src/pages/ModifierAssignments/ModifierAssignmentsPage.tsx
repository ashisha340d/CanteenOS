import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import type { MenuItemDto, ModifierAssignmentDto, ModifierGroupDto } from '@menuboard/shared';
import {
  GripVerticalIcon,
  Layers3Icon,
  LoaderCircleIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  useMenuAssignmentWorkspace,
  useMoveModifierAssignment,
  useRemoveMenuItemModifierGroupAssignments,
} from '@/hooks/useMenuMaster';
import { notify } from '@/lib/notify';
import { cn } from '@/lib/utils';
import { ItemThumbnail } from '../MenuItems/MenuItemsPage';

type DragPayload =
  | { type: 'modifier-group'; groupId: string }
  | {
    type: 'menu-item';
    itemId: string;
    sourceAssignmentId?: string;
    sourceGroupId?: string;
  };

export function ModifierAssignmentsPage(): JSX.Element {
  const { data, isLoading, isError, refetch } = useMenuAssignmentWorkspace();
  const move = useMoveModifierAssignment();
  const removeGroup = useRemoveMenuItemModifierGroupAssignments();
  const [modifierSearch, setModifierSearch] = useState('');
  const [menuSearch, setMenuSearch] = useState('');
  const [dragged, setDragged] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [openedGroupIds, setOpenedGroupIds] = useState<Set<string>>(() => new Set());
  const [removingGroup, setRemovingGroup] = useState<ModifierGroupDto | null>(null);
  const pending = move.isPending || removeGroup.isPending;

  const itemsById = useMemo(
    () => new Map((data?.menuItems ?? []).map((item) => [item.id, item])),
    [data?.menuItems],
  );
  const assignmentsByGroup = useMemo(() => {
    const grouped = new Map<string, ModifierAssignmentDto[]>();
    for (const assignment of data?.modifierAssignments ?? []) {
      grouped.set(assignment.modifierGroupId, [
        ...(grouped.get(assignment.modifierGroupId) ?? []),
        assignment,
      ]);
    }
    return grouped;
  }, [data?.modifierAssignments]);

  const modifierNeedle = modifierSearch.trim().toLocaleLowerCase();
  const menuNeedle = menuSearch.trim().toLocaleLowerCase();
  const filteredGroups = (data?.modifierGroups ?? []).filter(
    (group) =>
      modifierNeedle === '' ||
      group.name.toLocaleLowerCase().includes(modifierNeedle) ||
      (group.modifiers ?? []).some((modifier) =>
        modifier.name.toLocaleLowerCase().includes(modifierNeedle),
      ),
  );
  const filteredItems = (data?.menuItems ?? []).filter(
    (item) =>
      menuNeedle === '' ||
      item.name.toLocaleLowerCase().includes(menuNeedle) ||
      (item.nameHi ?? '').toLocaleLowerCase().includes(menuNeedle) ||
      (item.categoryName ?? '').toLocaleLowerCase().includes(menuNeedle),
  );
  const workspaceGroupIds = new Set([
    ...openedGroupIds,
    ...(data?.modifierAssignments ?? []).map((assignment) => assignment.modifierGroupId),
  ]);
  const workspaceGroups = (data?.modifierGroups ?? []).filter((group) => workspaceGroupIds.has(group.id));

  function beginDrag(event: DragEvent, payload: DragPayload): void {
    if (pending) return;
    event.dataTransfer.effectAllowed = payload.type === 'modifier-group' ? 'copy' : 'move';
    event.dataTransfer.setData('text/plain', payload.type);
    setDragged(payload);
  }

  function finishDrag(): void {
    setDragged(null);
    setDropTarget(null);
  }

  async function assignItem(groupId: string): Promise<void> {
    if (!dragged || dragged.type !== 'menu-item' || pending) return;
    if (dragged.sourceGroupId === groupId) {
      finishDrag();
      return;
    }
    try {
      await move.mutateAsync({
        entityType: 'MENU_ITEM',
        entityId: dragged.itemId,
        ...(dragged.sourceAssignmentId ? { sourceAssignmentId: dragged.sourceAssignmentId } : {}),
        targetModifierGroupId: groupId,
      });
      setOpenedGroupIds((current) => new Set(current).add(groupId));
      notify.success('Modifier assignment saved.');
    } catch (error) {
      notify.fromError(error);
    } finally {
      finishDrag();
    }
  }

  async function unassignItem(payload: Extract<DragPayload, { type: 'menu-item' }>): Promise<void> {
    if (!payload.sourceAssignmentId || pending) return;
    try {
      await move.mutateAsync({
        entityType: 'MENU_ITEM',
        entityId: payload.itemId,
        sourceAssignmentId: payload.sourceAssignmentId,
      });
      notify.success('Menu item unassigned.');
    } catch (error) {
      notify.fromError(error);
    } finally {
      finishDrag();
    }
  }

  function dropGroup(event: DragEvent, groupId: string): void {
    event.preventDefault();
    if (dragged?.type === 'modifier-group') {
      setOpenedGroupIds((current) => new Set(current).add(dragged.groupId));
      finishDrag();
      return;
    }
    void assignItem(groupId);
  }

  function dropWorkspace(event: DragEvent): void {
    event.preventDefault();
    if (dragged?.type !== 'modifier-group') return;
    setOpenedGroupIds((current) => new Set(current).add(dragged.groupId));
    finishDrag();
  }

  function requestRemoveGroup(group: ModifierGroupDto): void {
    if ((assignmentsByGroup.get(group.id) ?? []).length === 0) {
      setOpenedGroupIds((current) => {
        const next = new Set(current);
        next.delete(group.id);
        return next;
      });
      return;
    }
    setRemovingGroup(group);
  }

  async function confirmRemoveGroup(): Promise<void> {
    if (!removingGroup) return;
    try {
      await removeGroup.mutateAsync(removingGroup.id);
      setOpenedGroupIds((current) => {
        const next = new Set(current);
        next.delete(removingGroup.id);
        return next;
      });
      notify.success('Modifier group removed from the workspace.');
      setRemovingGroup(null);
    } catch (error) {
      notify.fromError(error);
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-3 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(15rem,0.9fr)_minmax(24rem,1.6fr)]">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[32rem] rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center">
        <p className="text-sm font-medium">Modifier assignments could not be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="grid min-h-0 gap-3 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(15rem,0.9fr)_minmax(24rem,1.6fr)]">
        <MasterPane
          title="Modifiers"
          count={data.modifierGroups.length}
          search={modifierSearch}
          onSearchChange={setModifierSearch}
          searchLabel="Search modifiers"
        >
          {filteredGroups.map((group) => (
            <div
              key={group.id}
              draggable={!pending}
              role="button"
              tabIndex={pending ? -1 : 0}
              aria-label={`Add ${group.name} to assignment workspace`}
              onKeyDown={(event) => {
                if (pending || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                setOpenedGroupIds((current) => new Set(current).add(group.id));
              }}
              onDragStart={(event) => beginDrag(event, { type: 'modifier-group', groupId: group.id })}
              onDragEnd={finishDrag}
              className={cn(
                'bg-background cursor-grab rounded-lg border p-2.5 shadow-xs transition-[border-color,box-shadow,opacity,transform] hover:border-border-strong hover:shadow-sm active:cursor-grabbing active:scale-[0.99]',
                pending && 'pointer-events-none opacity-60',
              )}
            >
              <div className="flex items-start gap-2">
                <GripVerticalIcon className="text-muted-foreground mt-0.5 size-3.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{group.name}</p>
                    {workspaceGroupIds.has(group.id) && (
                      <Badge variant="secondary" className="text-[0.625rem]">In workspace</Badge>
                    )}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(group.modifiers ?? []).slice(0, 4).map((modifier) => (
                      <span key={modifier.id} className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[0.6875rem]">
                        {modifier.name}
                      </span>
                    ))}
                    {(group.modifiers ?? []).length > 4 && (
                      <span className="text-muted-foreground px-1 py-0.5 text-[0.6875rem]">
                        +{(group.modifiers ?? []).length - 4}
                      </span>
                    )}
                    {(group.modifiers ?? []).length === 0 && (
                      <span className="text-muted-foreground text-[0.6875rem]">No modifier options</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
          {filteredGroups.length === 0 && <PaneEmpty label="No modifiers match this search." />}
        </MasterPane>

        <MasterPane
          title="Menu items"
          count={data.menuItems.length}
          search={menuSearch}
          onSearchChange={setMenuSearch}
          searchLabel="Search menu items"
        >
          {filteredItems.map((item) => (
            <MenuItemCard
              key={item.id}
              item={item}
              pending={pending}
              selected={dragged?.type === 'menu-item' && dragged.itemId === item.id && !dragged.sourceAssignmentId}
              onSelect={() => setDragged({ type: 'menu-item', itemId: item.id })}
              onDragStart={(event) => beginDrag(event, { type: 'menu-item', itemId: item.id })}
              onDragEnd={finishDrag}
            />
          ))}
          {filteredItems.length === 0 && <PaneEmpty label="No menu items match this search." />}
        </MasterPane>

        <section className="bg-card overflow-hidden rounded-xl border">
          <header className="flex min-h-12 items-center gap-2 border-b px-3 py-2.5">
            <Layers3Icon className="text-primary size-4" />
            <h2 className="flex-1 text-sm font-semibold">Assignment workspace</h2>
            {pending && <LoaderCircleIcon className="text-muted-foreground size-3.5 animate-spin" />}
            <Badge variant="secondary">{workspaceGroups.length}</Badge>
          </header>

          <div className="space-y-2 p-2">
            <div
              onDragOver={(event) => {
                if (dragged?.type !== 'menu-item' || !dragged.sourceAssignmentId) return;
                event.preventDefault();
                setDropTarget('__unassign__');
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged?.type === 'menu-item') void unassignItem(dragged);
              }}
              data-drop-zone="unassign"
              tabIndex={dragged?.type === 'menu-item' && dragged.sourceAssignmentId && !pending ? 0 : -1}
              onKeyDown={(event) => {
                if (
                  dragged?.type !== 'menu-item' ||
                  !dragged.sourceAssignmentId ||
                  pending ||
                  (event.key !== 'Enter' && event.key !== ' ')
                ) return;
                event.preventDefault();
                void unassignItem(dragged);
              }}
              className={cn(
                'text-muted-foreground flex h-9 items-center justify-center rounded-lg border border-dashed text-xs transition-colors',
                dropTarget === '__unassign__' && 'border-destructive bg-destructive/5 text-destructive',
              )}
            >
              Drop an assigned menu item here to unassign
            </div>

            <div
              onDragOver={(event) => {
                if (dragged?.type !== 'modifier-group') return;
                event.preventDefault();
                setDropTarget('__workspace__');
              }}
              onDrop={dropWorkspace}
              data-drop-zone="modifier-workspace"
              className={cn(
                'flex max-h-[calc(100vh-17rem)] min-h-[27rem] flex-col gap-2 overflow-y-auto rounded-lg transition-colors',
                dropTarget === '__workspace__' && 'bg-primary/5',
              )}
            >
              {workspaceGroups.map((group) => {
                const assignments = assignmentsByGroup.get(group.id) ?? [];
                return (
                  <article key={group.id} className="overflow-hidden rounded-xl border bg-background shadow-xs">
                    <header className="bg-muted/60 flex items-start gap-2 px-3 py-2.5">
                      <SparklesIcon className="text-primary mt-0.5 size-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold">{group.name}</h3>
                          <Badge variant="outline" className="tabular-nums">{assignments.length}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {(group.modifiers ?? []).map((modifier) => (
                            <span key={modifier.id} className="bg-background text-muted-foreground rounded border px-1.5 py-0.5 text-[0.6875rem]">
                              {modifier.name}{modifier.priceDelta !== 0 ? ` ${modifier.priceDelta > 0 ? '+' : ''}₹${modifier.priceDelta}` : ''}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={pending}
                        onClick={() => requestRemoveGroup(group)}
                        aria-label={`Remove ${group.name} from workspace`}
                      >
                        <XIcon />
                      </Button>
                    </header>
                    <Separator />
                    <div
                      onDragOver={(event) => {
                        if (dragged?.type !== 'menu-item') return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                        setDropTarget(group.id);
                      }}
                      onDrop={(event) => dropGroup(event, group.id)}
                      data-drop-zone={`modifier-group-${group.id}`}
                      tabIndex={dragged?.type === 'menu-item' && !pending ? 0 : -1}
                      onKeyDown={(event) => {
                        if (
                          dragged?.type !== 'menu-item' ||
                          pending ||
                          (event.key !== 'Enter' && event.key !== ' ')
                        ) return;
                        event.preventDefault();
                        void assignItem(group.id);
                      }}
                      className={cn(
                        'min-h-24 space-y-1.5 p-2 transition-colors',
                        dropTarget === group.id && 'bg-primary/5 ring-primary/20 ring-2 ring-inset',
                      )}
                    >
                      {assignments.map((assignment) => {
                        const item = itemsById.get(assignment.entityId);
                        if (!item) return null;
                        const payload: Extract<DragPayload, { type: 'menu-item' }> = {
                          type: 'menu-item',
                          itemId: item.id,
                          sourceAssignmentId: assignment.id,
                          sourceGroupId: group.id,
                        };
                        return (
                          <div
                            key={assignment.id}
                            draggable={!pending}
                            role="button"
                            tabIndex={pending ? -1 : 0}
                            aria-pressed={dragged?.type === 'menu-item' && dragged.sourceAssignmentId === assignment.id}
                            aria-label={`Select ${item.name} to move or unassign`}
                            onKeyDown={(event) => {
                              if (pending || (event.key !== 'Enter' && event.key !== ' ')) return;
                              event.preventDefault();
                              setDragged(payload);
                            }}
                            onDragStart={(event) => beginDrag(event, payload)}
                            onDragEnd={finishDrag}
                            className={cn(
                              'group flex cursor-grab items-center gap-2 rounded-lg border bg-card px-2 py-1.5 shadow-xs transition-[border-color,box-shadow,transform] hover:border-border-strong hover:shadow-sm active:cursor-grabbing active:scale-[0.99]',
                              dragged?.type === 'menu-item' && dragged.sourceAssignmentId === assignment.id &&
                              'border-primary ring-primary/20 ring-2',
                            )}
                          >
                            <GripVerticalIcon className="text-muted-foreground size-3.5 shrink-0" />
                            <ItemThumbnail item={item} className="size-8 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{item.name}</p>
                              <p className="text-muted-foreground truncate text-[0.6875rem]">{item.categoryName ?? item.unit}</p>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={pending}
                              onClick={() => void unassignItem(payload)}
                              aria-label={`Unassign ${item.name}`}
                              className="text-muted-foreground opacity-70 group-hover:opacity-100"
                            >
                              <XIcon />
                            </Button>
                          </div>
                        );
                      })}
                      {assignments.length === 0 && (
                        <div className={cn(
                          'text-muted-foreground flex min-h-20 items-center justify-center rounded-lg border border-dashed text-xs',
                          dropTarget === group.id && 'border-primary/60 text-primary',
                        )}>
                          Drop menu items here
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}

              {workspaceGroups.length === 0 && (
                <div className={cn(
                  'text-muted-foreground flex min-h-[27rem] items-center justify-center rounded-xl border border-dashed px-6 text-center text-sm',
                  dropTarget === '__workspace__' && 'border-primary text-primary',
                )}>
                  Drag a modifier group here to start an assignment section.
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(removingGroup)}
        title="Remove modifier assignments"
        message={`Remove "${removingGroup?.name}" from the workspace and unassign all of its menu items? The modifier group itself will not be deleted.`}
        confirmLabel="Remove assignments"
        danger
        loading={removeGroup.isPending}
        onConfirm={confirmRemoveGroup}
        onCancel={() => setRemovingGroup(null)}
      />
    </>
  );
}

function MasterPane({
  title,
  count,
  search,
  onSearchChange,
  searchLabel,
  children,
}: {
  title: string;
  count: number;
  search: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="bg-card overflow-hidden rounded-xl border">
      <header className="flex min-h-12 items-center gap-2 border-b px-3 py-2.5">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        <Badge variant="secondary" className="tabular-nums">{count}</Badge>
      </header>
      <div className="border-b p-2">
        <div className="relative">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchLabel}
            aria-label={searchLabel}
            className="pl-8"
          />
        </div>
      </div>
      <div className="flex max-h-[calc(100vh-15rem)] min-h-[28rem] flex-col gap-1.5 overflow-y-auto p-2">
        {children}
      </div>
    </section>
  );
}

function MenuItemCard({
  item,
  pending,
  selected,
  onSelect,
  onDragStart,
  onDragEnd,
}: {
  item: MenuItemDto;
  pending: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}): JSX.Element {
  return (
    <div
      draggable={!pending}
      role="button"
      tabIndex={pending ? -1 : 0}
      aria-pressed={selected}
      aria-label={`Select ${item.name} to assign`}
      onKeyDown={(event) => {
        if (pending || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onSelect();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'bg-background flex cursor-grab items-center gap-2 rounded-lg border px-2 py-1.5 shadow-xs transition-[border-color,box-shadow,opacity,transform] hover:border-border-strong hover:shadow-sm active:cursor-grabbing active:scale-[0.99]',
        pending && 'pointer-events-none opacity-60',
        selected && 'border-primary ring-primary/20 ring-2',
      )}
    >
      <GripVerticalIcon className="text-muted-foreground size-3.5 shrink-0" />
      <ItemThumbnail item={item} className="size-8 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.name}</p>
        <p className="text-muted-foreground truncate text-[0.6875rem]">{item.categoryName ?? item.unit}</p>
      </div>
    </div>
  );
}

function PaneEmpty({ label }: { label: string }): JSX.Element {
  return (
    <div className="text-muted-foreground flex min-h-32 items-center justify-center rounded-lg border border-dashed px-4 text-center text-xs">
      {label}
    </div>
  );
}
