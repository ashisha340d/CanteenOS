import type {
  AvailabilityStatus,
  CounterDto,
  CounterRouteDto,
  CounterRouteWriteRequest,
  CounterWriteRequest,
  ItemGroupAssignmentDto,
  ItemGroupAssignmentWriteRequest,
  ItemGroupDto,
  ItemGroupWriteRequest,
  MasterStatus,
  MenuCategoryAssignmentDto,
  MenuCategoryAssignmentWriteRequest,
  MenuDto,
  MenuItemAssignmentDto,
  MenuItemAssignmentWriteRequest,
  MenuItemScheduleBulkResponse,
  MenuItemScheduleBulkWriteRequest,
  MenuItemVariantCatalogPriceDto,
  MenuItemVariantCatalogPriceWriteRequest,
  MenuItemVariantDto,
  MenuItemVariantWriteRequest,
  MenuWriteRequest,
  MenuTreeDto,
  ModifierDto,
  ModifierGroupDto,
  ModifierGroupWriteRequest,
  ModifierWriteRequest,
  PageQuery,
  PrintingGroupDto,
  PrintingGroupWriteRequest,
  PrintingRouteDto,
  PrintingRouteWriteRequest,
  RoutableEntityType,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface MasterListQuery extends PageQuery {
  status?: MasterStatus;
}

export const menusApi = {
  list: (query: MasterListQuery) => unwrapPaged<MenuDto>(http.get('/menus', { params: query })),
  get: (id: string) => unwrap<MenuDto>(http.get(`/menus/${id}`)),
  create: (body: MenuWriteRequest) => unwrap<MenuDto>(http.post('/menus', body)),
  update: (id: string, body: Partial<MenuWriteRequest>) =>
    unwrap<MenuDto>(http.patch(`/menus/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menus/${id}`)),
  restore: (id: string) => unwrap<MenuDto>(http.post(`/menus/${id}/restore`)),
  publish: (id: string) => unwrap<MenuDto>(http.post(`/menus/${id}/publish`)),
  unpublish: (id: string) => unwrap<MenuDto>(http.post(`/menus/${id}/unpublish`)),
  tree: (code: string) => unwrap<MenuTreeDto>(http.get(`/menus/by-code/${code}/tree`)),
};

export const menuCategoryAssignmentsApi = {
  listForMenu: (menuId: string, includeInactive?: boolean) =>
    unwrap<MenuCategoryAssignmentDto[]>(
      http.get(`/menus/${menuId}/categories`, { params: { includeInactive } }),
    ),
  assign: (menuId: string, body: MenuCategoryAssignmentWriteRequest) =>
    unwrap<MenuCategoryAssignmentDto>(http.post(`/menus/${menuId}/categories`, body)),
  update: (id: string, body: Partial<MenuCategoryAssignmentWriteRequest>) =>
    unwrap<MenuCategoryAssignmentDto>(http.patch(`/menu-category-assignments/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menu-category-assignments/${id}`)),
};

export interface MenuItemAssignmentListQuery extends PageQuery {
  menuId?: string;
  categoryAssignmentId?: string;
  availability?: AvailabilityStatus;
}

export const menuItemAssignmentsApi = {
  list: (query: MenuItemAssignmentListQuery) =>
    unwrapPaged<MenuItemAssignmentDto>(http.get('/menu-item-assignments', { params: query })),
  assign: (menuId: string, body: MenuItemAssignmentWriteRequest) =>
    unwrap<MenuItemAssignmentDto>(http.post(`/menus/${menuId}/items`, body)),
  update: (id: string, body: Partial<MenuItemAssignmentWriteRequest>) =>
    unwrap<MenuItemAssignmentDto>(http.patch(`/menu-item-assignments/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menu-item-assignments/${id}`)),
};

export const menuItemVariantsApi = {
  // Variants belong to the Food Item Master (menu_items), not any one menu.
  listForFoodItem: (foodItemId: string, includeInactive?: boolean) =>
    unwrap<MenuItemVariantDto[]>(
      http.get(`/menu-items/${foodItemId}/variants`, { params: { includeInactive } }),
    ),
  create: (foodItemId: string, body: MenuItemVariantWriteRequest) =>
    unwrap<MenuItemVariantDto>(http.post(`/menu-items/${foodItemId}/variants`, body)),
  update: (id: string, body: Partial<MenuItemVariantWriteRequest>) =>
    unwrap<MenuItemVariantDto>(http.patch(`/menu-item-variants/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menu-item-variants/${id}`)),
};

export const countersApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<CounterDto>(http.get('/counters', { params: query })),
  create: (body: CounterWriteRequest) => unwrap<CounterDto>(http.post('/counters', body)),
  update: (id: string, body: Partial<CounterWriteRequest>) =>
    unwrap<CounterDto>(http.patch(`/counters/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/counters/${id}`)),
};

export const counterRoutesApi = {
  listForEntity: (entityType: RoutableEntityType, entityId: string) =>
    unwrap<CounterRouteDto[]>(http.get('/counter-routes', { params: { entityType, entityId } })),
  assign: (body: CounterRouteWriteRequest) => unwrap<CounterRouteDto>(http.post('/counter-routes', body)),
  remove: (id: string) => unwrap<null>(http.delete(`/counter-routes/${id}`)),
};

export const itemGroupsApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<ItemGroupDto>(http.get('/item-groups', { params: query })),
  create: (body: ItemGroupWriteRequest) => unwrap<ItemGroupDto>(http.post('/item-groups', body)),
  update: (id: string, body: Partial<ItemGroupWriteRequest>) =>
    unwrap<ItemGroupDto>(http.patch(`/item-groups/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/item-groups/${id}`)),
};

export const itemGroupAssignmentsApi = {
  listForFoodItem: (foodItemId: string) =>
    unwrap<ItemGroupAssignmentDto[]>(http.get(`/item-groups/for-item/${foodItemId}`)),
  assign: (body: ItemGroupAssignmentWriteRequest) =>
    unwrap<ItemGroupAssignmentDto>(http.post('/item-groups/assign', body)),
  remove: (id: string) => unwrap<null>(http.delete(`/item-group-assignments/${id}`)),
};

export const menuItemScheduleApi = {
  get: (foodItemId: string) =>
    unwrap<MenuItemScheduleBulkResponse>(http.get(`/menu-items/${foodItemId}/schedule`)),
  set: (foodItemId: string, body: MenuItemScheduleBulkWriteRequest) =>
    unwrap<MenuItemScheduleBulkResponse>(http.put(`/menu-items/${foodItemId}/schedule`, body)),
};

export const variantCatalogPricesApi = {
  listForVariant: (variantId: string) =>
    unwrap<MenuItemVariantCatalogPriceDto[]>(http.get(`/menu-item-variants/${variantId}/catalog-prices`)),
  set: (variantId: string, body: MenuItemVariantCatalogPriceWriteRequest) =>
    unwrap<MenuItemVariantCatalogPriceDto[]>(
      http.put(`/menu-item-variants/${variantId}/catalog-prices`, body),
    ),
};

export const printingGroupsApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<PrintingGroupDto>(http.get('/printing-groups', { params: query })),
  create: (body: PrintingGroupWriteRequest) =>
    unwrap<PrintingGroupDto>(http.post('/printing-groups', body)),
  update: (id: string, body: Partial<PrintingGroupWriteRequest>) =>
    unwrap<PrintingGroupDto>(http.patch(`/printing-groups/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/printing-groups/${id}`)),
};

export const printingRoutesApi = {
  listForEntity: (entityType: RoutableEntityType, entityId: string) =>
    unwrap<PrintingRouteDto[]>(http.get('/printing-routes', { params: { entityType, entityId } })),
  assign: (body: PrintingRouteWriteRequest) => unwrap<PrintingRouteDto>(http.post('/printing-routes', body)),
  remove: (id: string) => unwrap<null>(http.delete(`/printing-routes/${id}`)),
};

export const modifierGroupsApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<ModifierGroupDto>(http.get('/modifier-groups', { params: query })),
  create: (body: ModifierGroupWriteRequest) =>
    unwrap<ModifierGroupDto>(http.post('/modifier-groups', body)),
  update: (id: string, body: Partial<ModifierGroupWriteRequest>) =>
    unwrap<ModifierGroupDto>(http.patch(`/modifier-groups/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/modifier-groups/${id}`)),
};

export const modifiersApi = {
  create: (groupId: string, body: ModifierWriteRequest) =>
    unwrap<ModifierDto>(http.post(`/modifier-groups/${groupId}/modifiers`, body)),
  update: (id: string, body: Partial<ModifierWriteRequest>) =>
    unwrap<ModifierDto>(http.patch(`/modifiers/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/modifiers/${id}`)),
};
