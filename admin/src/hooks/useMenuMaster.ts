import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CounterRouteWriteRequest,
  CounterWriteRequest,
  ItemGroupAssignmentWriteRequest,
  ItemGroupWriteRequest,
  MenuCategoryAssignmentWriteRequest,
  MenuItemAssignmentWriteRequest,
  MenuItemScheduleBulkWriteRequest,
  MenuItemVariantCatalogPriceWriteRequest,
  MenuItemVariantWriteRequest,
  MenuWriteRequest,
  ModifierGroupWriteRequest,
  ModifierWriteRequest,
  PrintingGroupWriteRequest,
  PrintingRouteWriteRequest,
  RoutableEntityType,
} from '@menuboard/shared';
import {
  counterRoutesApi,
  countersApi,
  itemGroupAssignmentsApi,
  itemGroupsApi,
  menuCategoryAssignmentsApi,
  menuItemAssignmentsApi,
  menuItemScheduleApi,
  menuItemVariantsApi,
  menusApi,
  modifierGroupsApi,
  modifiersApi,
  printingGroupsApi,
  printingRoutesApi,
  variantCatalogPricesApi,
  type MasterListQuery,
  type MenuItemAssignmentListQuery,
} from '../api/menuMaster';

/* --------------------------------------------------------------------------- menus */

export function useMenus(query: MasterListQuery) {
  return useQuery({ queryKey: ['menus', query], queryFn: () => menusApi.list(query), placeholderData: (p) => p });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
  });
}
export function useDeleteMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
  });
}
export function useUnpublishMenu() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => menusApi.unpublish(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menus'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counters'] }),
  });
}
export function useUpdateCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CounterWriteRequest> }) =>
      countersApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counters'] }),
  });
}
export function useDeleteCounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => countersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['counters'] }),
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

export function useItemGroups(query: MasterListQuery) {
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

export function useItemGroupsForFoodItem(foodItemId: string) {
  return useQuery({
    queryKey: ['item-group-assignments', foodItemId],
    queryFn: () => itemGroupAssignmentsApi.listForFoodItem(foodItemId),
    enabled: Boolean(foodItemId),
  });
}
export function useAssignItemGroup(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemGroupAssignmentWriteRequest) => itemGroupAssignmentsApi.assign(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-group-assignments', foodItemId] }),
  });
}
export function useRemoveItemGroupAssignment(foodItemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => itemGroupAssignmentsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['item-group-assignments', foodItemId] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printing-groups'] }),
  });
}
export function useUpdatePrintingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PrintingGroupWriteRequest> }) =>
      printingGroupsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printing-groups'] }),
  });
}
export function useDeletePrintingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => printingGroupsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['printing-groups'] }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
export function useUpdateModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModifierGroupWriteRequest> }) =>
      modifierGroupsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
export function useDeleteModifierGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => modifierGroupsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
export function useCreateModifier(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ModifierWriteRequest) => modifiersApi.create(groupId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
export function useUpdateModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModifierWriteRequest> }) =>
      modifiersApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
export function useDeleteModifier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => modifiersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['modifier-groups'] }),
  });
}
