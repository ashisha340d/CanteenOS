import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CounterRouteMoveRequest,
  CounterRouteWriteRequest,
  CounterWriteRequest,
  ItemGroupWriteRequest,
  MenuCategoryAssignmentWriteRequest,
  MenuAssignmentWorkspaceDto,
  MenuItemAssignmentWriteRequest,
  MenuItemScheduleBulkWriteRequest,
  MenuItemVariantCatalogPriceWriteRequest,
  MenuItemVariantWriteRequest,
  MenuWriteRequest,
  CreateMenuBoardScreenRequest,
  UpdateMenuBoardScreenRequest,
  ModifierAssignmentMoveRequest,
  ModifierGroupWriteRequest,
  ModifierWriteRequest,
  PrintingGroupWriteRequest,
  PrintingRouteMoveRequest,
  PrintingRouteWriteRequest,
  RoutableEntityType,
} from '@menuboard/shared';
import {
  counterRoutesApi,
  countersApi,
  itemGroupsApi,
  menuCategoryAssignmentsApi,
  menuItemAssignmentsApi,
  menuItemScheduleApi,
  menuItemVariantsApi,
  menuAssignmentWorkspaceApi,
  menuBoardScreensApi,
  menusApi,
  modifierAssignmentsApi,
  modifierGroupsApi,
  modifiersApi,
  printingGroupsApi,
  printingRoutesApi,
  variantCatalogPricesApi,
  type MasterListQuery,
  type MenuItemAssignmentListQuery,
} from '../api/menuMaster';

/* --------------------------------------------------------------------------- menus */

export function useMenuAssignmentWorkspace() {
  return useQuery({
    queryKey: ['menu-assignment-workspace'],
    queryFn: menuAssignmentWorkspaceApi.get,
  });
}

export function useMenus(query: MasterListQuery) {
  return useQuery({ queryKey: ['menus', query], queryFn: () => menusApi.list(query), placeholderData: (p) => p });
}

/**
 * Which menus are servable right now. Answered against the *server* clock, so it re-reads on
 * a minute-ish beat rather than trusting the workstation's own — a menu whose window has just
 * closed must stop being shown even if nobody touched this screen, and the countdown to the
 * next opening has to keep moving on its own.
 */
export function useActiveMenus(enabled = true) {
  return useQuery({
    queryKey: ['menus-active'],
    queryFn: menusApi.active,
    enabled,
    refetchInterval: 60_000,
    placeholderData: (previous) => previous,
  });
}
/**
 * Every Menu Catalogue, as `SelectField` options, for the pickers on Menu Categories and Menu
 * Groups. There are a handful of catalogues, so one unpaginated read is cheaper than a
 * searchable picker and lets the whole list sit open in front of the operator.
 */
export function useCatalogueOptions() {
  const { data, isLoading } = useMenus({ page: 1, pageSize: 100 });
  const options = (data?.items ?? []).map((menu) => ({
    value: menu.id,
    label: menu.name,
  }));
  return { options, isLoading };
}

export function useMenu(id: string) {
  return useQuery({ queryKey: ['menu', id], queryFn: () => menusApi.get(id), enabled: Boolean(id) });
}
export function useCreateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuWriteRequest) => menusApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
  });
}
export function useUpdateMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuWriteRequest> }) =>
      menusApi.update(id, body),
    onSuccess: (menu, variables) => {
      qc.setQueryData(['menu', variables.id], menu);
      qc.invalidateQueries({ queryKey: ['menus'] });
    },
  });
}
export function useDeleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.remove(id),
    onSuccess: (_data, id) => {
      qc.removeQueries({ queryKey: ['menu', id] });
      qc.invalidateQueries({ queryKey: ['menus'] });
      qc.invalidateQueries({ queryKey: ['menu-category-assignments'] });
      qc.invalidateQueries({ queryKey: ['menu-item-assignments'] });
    },
  });
}
export function useRestoreMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.restore(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
  });
}
export function usePublishMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.publish(id),
    onSuccess: (menu, id) => {
      qc.setQueryData(['menu', id], menu);
      qc.invalidateQueries({ queryKey: ['menus'] });
    },
  });
}
export function useUnpublishMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.unpublish(id),
    onSuccess: (menu, id) => {
      qc.setQueryData(['menu', id], menu);
      qc.invalidateQueries({ queryKey: ['menus'] });
    },
  });
}

/* --------------------------------------------------------- menu category assignments */

export function useMenuCategoryAssignments(menuId: string, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['menu-category-assignments', menuId, includeInactive],
    queryFn: () => menuCategoryAssignmentsApi.listForMenu(menuId, includeInactive),
    enabled: Boolean(menuId),
  });
}
export function useAssignMenuCategory(menuId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuCategoryAssignmentWriteRequest) =>
      menuCategoryAssignmentsApi.assign(menuId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-category-assignments', menuId] }),
  });
}
export function useUpdateMenuCategoryAssignment(menuId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuCategoryAssignmentWriteRequest> }) =>
      menuCategoryAssignmentsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-category-assignments', menuId] }),
  });
}
export function useRemoveMenuCategoryAssignment(menuId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menuCategoryAssignmentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-category-assignments', menuId] }),
  });
}

/* -------------------------------------------------------------- menu item assignments */

export function useMenuItemAssignments(query: MenuItemAssignmentListQuery) {
  return useQuery({
    queryKey: ['menu-item-assignments', query],
    queryFn: () => menuItemAssignmentsApi.list(query),
    placeholderData: (p) => p,
    enabled: Boolean(query.menuId),
  });
}
export function useAssignMenuItem(menuId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuItemAssignmentWriteRequest) => menuItemAssignmentsApi.assign(menuId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-item-assignments'] }),
  });
}
export function useUpdateMenuItemAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuItemAssignmentWriteRequest> }) =>
      menuItemAssignmentsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-item-assignments'] }),
  });
}
export function useRemoveMenuItemAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menuItemAssignmentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-item-assignments'] }),
  });
}

/* --------------------------------------------------------------------------- variants */
/* Variants belong to the Food Item Master (menu_items), never to a menu-specific assignment. */

export function useMenuItemVariants(foodItemId: string, includeInactive?: boolean) {
  return useQuery({
    queryKey: ['menu-item-variants', foodItemId, includeInactive],
    queryFn: () => menuItemVariantsApi.listForFoodItem(foodItemId, includeInactive),
    enabled: Boolean(foodItemId),
  });
}
export function useCreateVariant(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuItemVariantWriteRequest) => menuItemVariantsApi.create(foodItemId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-item-variants', foodItemId] });
      qc.invalidateQueries({ queryKey: ['menu-item-assignments'] });
    },
  });
}
export function useUpdateVariant(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuItemVariantWriteRequest> }) =>
      menuItemVariantsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-item-variants', foodItemId] }),
  });
}
export function useDeleteVariant(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menuItemVariantsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-item-variants', foodItemId] });
      qc.invalidateQueries({ queryKey: ['menu-item-assignments'] });
    },
  });
}

/* ------------------------------------------------------------------------ counters */

export function useCounters(query: MasterListQuery) {
  return useQuery({
    queryKey: ['counters', query],
    queryFn: () => countersApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreateCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CounterWriteRequest) => countersApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['counters'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useUpdateCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CounterWriteRequest> }) =>
      countersApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['counters'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useDeleteCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => countersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['counters'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}

/* ------------------------------------------------------------------ counter routes */
/* Generic polymorphic routing — used here for MENU_ITEM (a food item's own service counters),
   but the same endpoints also route MENU_ITEM_ASSIGNMENT/MENU_ITEM_VARIANT elsewhere. */

export function useCounterRoutesForEntity(entityType: RoutableEntityType, entityId: string) {
  return useQuery({
    queryKey: ['counter-routes', entityType, entityId],
    queryFn: () => counterRoutesApi.listForEntity(entityType, entityId),
    enabled: Boolean(entityId),
  });
}
export function useAssignCounterRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CounterRouteWriteRequest) => counterRoutesApi.assign(body),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['counter-routes', variables.entityType, variables.entityId] }),
  });
}
export function useMoveCounterRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CounterRouteMoveRequest) => counterRoutesApi.move(body),
    onSuccess: (routes, variables) => {
      qc.setQueryData<MenuAssignmentWorkspaceDto>(['menu-assignment-workspace'], (workspace) =>
        workspace
          ? {
            ...workspace,
            counterRoutes: [
              ...workspace.counterRoutes.filter(
                (route) =>
                  route.entityType !== variables.entityType || route.entityId !== variables.entityId,
              ),
              ...routes,
            ],
          }
          : workspace,
      );
      qc.invalidateQueries({ queryKey: ['counter-routes', variables.entityType, variables.entityId] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] }),
  });
}

export function useRemoveCounterRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; entityType: RoutableEntityType; entityId: string }) =>
      counterRoutesApi.remove(id),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['counter-routes', variables.entityType, variables.entityId] }),
  });
}

/* ---------------------------------------------------------------------- item groups */

export function useItemGroups(query: MasterListQuery & { catalogueId?: string }) {
  return useQuery({
    queryKey: ['item-groups', query],
    queryFn: () => itemGroupsApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreateItemGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemGroupWriteRequest) => itemGroupsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-groups'] }),
  });
}
export function useUpdateItemGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ItemGroupWriteRequest> }) =>
      itemGroupsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-groups'] }),
  });
}
export function useDeleteItemGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => itemGroupsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-groups'] }),
  });
}

/* -------------------------------------------------------------------- item schedule */

export function useMenuItemSchedule(foodItemId: string) {
  return useQuery({
    queryKey: ['menu-item-schedule', foodItemId],
    queryFn: () => menuItemScheduleApi.get(foodItemId),
    enabled: Boolean(foodItemId),
  });
}
export function useSetMenuItemSchedule(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuItemScheduleBulkWriteRequest) => menuItemScheduleApi.set(foodItemId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-item-schedule', foodItemId] }),
  });
}

/* ------------------------------------------------------------- variant catalog prices */

export function useVariantCatalogPrices(variantId: string) {
  return useQuery({
    queryKey: ['variant-catalog-prices', variantId],
    queryFn: () => variantCatalogPricesApi.listForVariant(variantId),
    enabled: Boolean(variantId),
  });
}
export function useSetVariantCatalogPrice(variantId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MenuItemVariantCatalogPriceWriteRequest) =>
      variantCatalogPricesApi.set(variantId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['variant-catalog-prices', variantId] }),
  });
}

/* ----------------------------------------------------------------- printing groups */

export function usePrintingGroups(query: MasterListQuery) {
  return useQuery({
    queryKey: ['printing-groups', query],
    queryFn: () => printingGroupsApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreatePrintingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PrintingGroupWriteRequest) => printingGroupsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printing-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useUpdatePrintingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PrintingGroupWriteRequest> }) =>
      printingGroupsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printing-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useDeletePrintingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => printingGroupsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['printing-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}

/* ----------------------------------------------------------------- printing routes */

export function usePrintingRoutesForEntity(entityType: RoutableEntityType, entityId: string) {
  return useQuery({
    queryKey: ['printing-routes', entityType, entityId],
    queryFn: () => printingRoutesApi.listForEntity(entityType, entityId),
    enabled: Boolean(entityId),
  });
}
export function useAssignPrintingRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PrintingRouteWriteRequest) => printingRoutesApi.assign(body),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['printing-routes', variables.entityType, variables.entityId] }),
  });
}
export function useMovePrintingRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PrintingRouteMoveRequest) => printingRoutesApi.move(body),
    onSuccess: (routes, variables) => {
      qc.setQueryData<MenuAssignmentWorkspaceDto>(['menu-assignment-workspace'], (workspace) =>
        workspace
          ? {
            ...workspace,
            printingRoutes: [
              ...workspace.printingRoutes.filter(
                (route) =>
                  route.entityType !== variables.entityType || route.entityId !== variables.entityId,
              ),
              ...routes,
            ],
          }
          : workspace,
      );
      qc.invalidateQueries({ queryKey: ['printing-routes', variables.entityType, variables.entityId] });
    },
    onError: () => qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] }),
  });
}

export function useRemovePrintingRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; entityType: RoutableEntityType; entityId: string }) =>
      printingRoutesApi.remove(id),
    onSuccess: (_data, variables) =>
      qc.invalidateQueries({ queryKey: ['printing-routes', variables.entityType, variables.entityId] }),
  });
}

/* --------------------------------------------------------------------- modifiers */

export function useModifierGroups(query: MasterListQuery) {
  return useQuery({
    queryKey: ['modifier-groups', query],
    queryFn: () => modifierGroupsApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useCreateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModifierGroupWriteRequest) => modifierGroupsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModifierGroupWriteRequest> }) =>
      modifierGroupsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => modifierGroupsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useCreateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModifierWriteRequest) => modifiersApi.create(groupId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useUpdateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModifierWriteRequest> }) =>
      modifiersApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}
export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => modifiersApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['modifier-groups'] });
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}

export function useMoveModifierAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModifierAssignmentMoveRequest) => modifierAssignmentsApi.move(body),
    onSuccess: (assignments, variables) => {
      qc.setQueryData<MenuAssignmentWorkspaceDto>(['menu-assignment-workspace'], (workspace) =>
        workspace
          ? {
            ...workspace,
            modifierAssignments: [
              ...workspace.modifierAssignments.filter(
                (assignment) =>
                  assignment.entityType !== variables.entityType ||
                  assignment.entityId !== variables.entityId,
              ),
              ...assignments,
            ],
          }
          : workspace,
      );
    },
    onError: () => qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] }),
  });
}

export function useRemoveMenuItemModifierGroupAssignments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (groupId: string) => modifierAssignmentsApi.removeGroupFromMenuItems(groupId),
    onSuccess: (_data, groupId) => {
      qc.setQueryData<MenuAssignmentWorkspaceDto>(['menu-assignment-workspace'], (workspace) =>
        workspace
          ? {
            ...workspace,
            modifierAssignments: workspace.modifierAssignments.filter(
              (assignment) => assignment.modifierGroupId !== groupId,
            ),
          }
          : workspace,
      );
      qc.invalidateQueries({ queryKey: ['menu-assignment-workspace'] });
    },
  });
}

/* -------------------------------------------------------------- digital menu board screens */

export function useMenuBoardScreens() {
  // Polled, for the same reason the kiosk list is: `lastSeenAt` is the only signal the portal
  // has that a screen on a wall two floors away is actually switched on.
  return useQuery({
    queryKey: ['menu-board-screens'],
    queryFn: menuBoardScreensApi.list,
    refetchInterval: 60_000,
  });
}

export function useMenuBoardScreen(id: string) {
  return useQuery({
    queryKey: ['menu-board-screen', id],
    queryFn: () => menuBoardScreensApi.get(id),
    enabled: Boolean(id),
  });
}

/**
 * The very snapshot the wall screen renders, so an ad can be tagged to a dish by picking from
 * exactly the list the board will look that tag up in.
 *
 * Deliberately the public board endpoint rather than the Menu Master tree: the ids the board
 * matches on are the ones this endpoint emits, and a variant contributes one line per portion
 * here but a single node there. Resolving the tree in the portal would mean re-deriving that
 * flattening and keeping the two derivations in step forever.
 *
 * `preview=1` for the same reason the layout editor's iframe sends it — reading the list to
 * build an ad must not tell the portal that a screen on a wall is switched on.
 */
export function useMenuBoardSnapshot(code: string) {
  return useQuery({
    queryKey: ['menu-board-snapshot', code],
    queryFn: () => menuBoardScreensApi.snapshot(code),
    enabled: Boolean(code),
    staleTime: 60_000,
  });
}

export function useCreateMenuBoardScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMenuBoardScreenRequest) => menuBoardScreensApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-board-screens'] }),
  });
}

export function useUpdateMenuBoardScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMenuBoardScreenRequest }) =>
      menuBoardScreensApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-board-screens'] }),
  });
}

export function useDeleteMenuBoardScreen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menuBoardScreensApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-board-screens'] }),
  });
}
