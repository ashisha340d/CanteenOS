import {
  MasterStatus,
  type AvailabilityStatus,
  type CounterRouteWriteRequest,
  type CounterWriteRequest,
  type ItemGroupAssignmentWriteRequest,
  type ItemGroupWriteRequest,
  type MediaEntityType,
  type MenuCategoryAssignmentWriteRequest,
  type MenuItemAssignmentWriteRequest,
  type MenuItemScheduleBulkResponse,
  type MenuItemScheduleBulkWriteRequest,
  type MenuItemVariantCatalogPriceWriteRequest,
  type MenuItemVariantWriteRequest,
  type MenuScheduleWriteRequest,
  type MenuTreeDto,
  type MenuWriteRequest,
  type ModifierAssignmentWriteRequest,
  type ModifierGroupWriteRequest,
  type ModifierWriteRequest,
  type PrintingGroupWriteRequest,
  type PrintingRouteWriteRequest,
  type ResolvedMenuCategoryDto,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
  type RoutableEntityType,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import {
  mapCounter,
  mapCounterRoute,
  mapItemGroup,
  mapItemGroupAssignment,
  mapMenu,
  mapMenuCategoryAssignment,
  mapMenuItemAssignment,
  mapMenuItemSchedule,
  mapMenuItemVariant,
  mapMenuSchedule,
  mapModifier,
  mapModifierAssignment,
  mapModifierGroup,
  mapPrintingGroup,
  mapPrintingRoute,
  mapVariantCatalogPrice,
} from '../models/mappers';
import { menuItemRepository, type MasterListFilter } from '../repositories/MasterRepository';
import {
  counterRepository,
  counterRouteRepository,
  itemGroupAssignmentRepository,
  itemGroupRepository,
  menuCategoryAssignmentRepository,
  menuItemAssignmentRepository,
  menuItemScheduleRepository,
  menuItemVariantCatalogPriceRepository,
  menuItemVariantRepository,
  menuRepository,
  menuScheduleRepository,
  modifierAssignmentRepository,
  modifierGroupRepository,
  modifierRepository,
  printingGroupRepository,
  printingRouteRepository,
  type MenuItemAssignmentListFilter,
} from '../repositories/MenuMasterRepository';
import { mediaAssignmentRepository } from '../repositories/MediaRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { signMenuMediaUrl } from '../utils/mediaStorage';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface MenuMasterQuery {
  search?: string;
  status?: MasterStatus;
  page?: number;
  pageSize?: number;
}

function pagingFor(query: MenuMasterQuery): MasterListFilter & { page: number; pageSize: number } {
  const { page, pageSize, offset } = resolvePaging(query);
  return {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    limit: pageSize,
    offset,
    page,
    pageSize,
  };
}

/**
 * The Menu Master service layer: menus, menu-category assignments, menu-item assignments,
 * variants, counters/printing/modifier routing, and schedules.
 *
 * Every write is Admin Portal only, mirroring MasterService — MASTER_WRITE is in
 * ANDROID_FORBIDDEN_CAPABILITIES, so none of this is reachable from a device session.
 *
 * `menu_items` (the Food Item Master) and `menu_categories` (the global category master) are
 * never written here — only referenced. Nothing in this service can create a duplicate food
 * item or category; it only ever creates the assignment that offers an existing one on a menu.
 */
export class MenuMasterService {
  /* ---------------------------------------------------------------------------- menus */

  async listMenus(query: MenuMasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await menuRepository.list(getPool(), filter);
    return buildPage(rows.map(mapMenu), total, filter.page, filter.pageSize);
  }

  async getMenuById(id: string) {
    const row = await menuRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Menu', id);
    return mapMenu(row);
  }

  async createMenu(input: MenuWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const existing = await menuRepository.findByCode(connection, input.code);
      if (existing !== null) {
        throw new ConflictError(`A menu with code "${input.code}" already exists`);
      }
      const created = await menuRepository.insert(connection, {
        id: input.id ?? newId(),
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        priority: input.priority ?? 0,
        effectiveFrom: input.effectiveFrom ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu',
        entityId: created.id,
        after: { code: created.code, name: created.name },
      });
      return created;
    });
    this.announce('menus', Number(row.sync_seq));
    return mapMenu(row);
  }

  async updateMenu(id: string, input: Partial<MenuWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await menuRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu', id);

      if (input.code !== undefined && input.code !== before.code) {
        const existing = await menuRepository.findByCode(connection, input.code);
        if (existing !== null) {
          throw new ConflictError(`A menu with code "${input.code}" already exists`);
        }
      }

      const updated = await menuRepository.update(connection, id, {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
        ...(input.effectiveUntil !== undefined ? { effectiveUntil: input.effectiveUntil } : {}),
        bumpVersion: true,
      });
      if (updated === null) throw new NotFoundError('Menu', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: updated.name, status: updated.status },
      });
      return updated;
    });
    this.announce('menus', Number(row.sync_seq));
    return mapMenu(row);
  }

  async publishMenu(id: string, actor: AuditActor) {
    return this.setPublished(id, true, actor);
  }

  async unpublishMenu(id: string, actor: AuditActor) {
    return this.setPublished(id, false, actor);
  }

  private async setPublished(id: string, published: boolean, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await menuRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu', id);
      const updated = await menuRepository.setPublished(connection, id, published);
      if (updated === null) throw new NotFoundError('Menu', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu',
        entityId: id,
        after: { published },
      });
      return updated;
    });
    this.announce('menus', Number(row.sync_seq));
    return mapMenu(row);
  }

  /** Refused while the menu still has any category or item assignments — deactivate instead. */
  async deleteMenu(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await menuRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu', id);

      const references = await menuRepository.countAssignmentReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `This menu still has ${references} categor(y/ies)/item(s) assigned; remove them first or deactivate the menu instead`,
        );
      }

      await menuRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
    this.announce('menus', 0);
  }

  async restoreMenu(id: string, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await menuRepository.findByIdIncludingDeleted(connection, id);
      if (before === null) throw new NotFoundError('Menu', id);
      const restored = await menuRepository.restore(connection, id);
      if (restored === null) throw new ConflictError('This menu is not deleted');
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu',
        entityId: id,
        after: { restored: true },
      });
      return restored;
    });
    this.announce('menus', Number(row.sync_seq));
    return mapMenu(row);
  }

  /* ------------------------------------------------------- menu category assignments */

  async listMenuCategoryAssignments(menuId: string, includeInactive = false) {
    const rows = await menuCategoryAssignmentRepository.listForMenu(getPool(), menuId, includeInactive);
    return rows.map(mapMenuCategoryAssignment);
  }

  /** Assigns an existing global category to a menu. Never creates a new category. */
  async assignCategoryToMenu(
    menuId: string,
    input: MenuCategoryAssignmentWriteRequest,
    actor: AuditActor,
  ) {
    const row = await withTransaction(async (connection) => {
      const menu = await menuRepository.findById(connection, menuId);
      if (menu === null) throw new NotFoundError('Menu', menuId);

      const existing = await menuCategoryAssignmentRepository.findByMenuAndCategory(
        connection,
        menuId,
        input.categoryId,
      );
      if (existing !== null) {
        throw new ConflictError('This category is already assigned to this menu');
      }

      const created = await menuCategoryAssignmentRepository.insert(connection, {
        id: input.id ?? newId(),
        menuId,
        categoryId: input.categoryId,
        displayName: input.displayName ?? null,
        displayNameHi: input.displayNameHi ?? null,
        description: input.description ?? null,
        descriptionHi: input.descriptionHi ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        posVisible: input.posVisible ?? true,
        boardVisible: input.boardVisible ?? true,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_category_assignment',
        entityId: created.id,
        after: { menuId, categoryId: input.categoryId },
      });
      return created;
    });
    this.announce('menu-category-assignments', Number(row.sync_seq));
    return mapMenuCategoryAssignment(row);
  }

  async updateMenuCategoryAssignment(
    id: string,
    input: Partial<MenuCategoryAssignmentWriteRequest>,
    actor: AuditActor,
  ) {
    const row = await withTransaction(async (connection) => {
      const before = await menuCategoryAssignmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu category assignment', id);

      const updated = await menuCategoryAssignmentRepository.update(connection, id, {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.displayNameHi !== undefined ? { displayNameHi: input.displayNameHi } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.descriptionHi !== undefined ? { descriptionHi: input.descriptionHi } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.posVisible !== undefined ? { posVisible: input.posVisible } : {}),
        ...(input.boardVisible !== undefined ? { boardVisible: input.boardVisible } : {}),
      });
      if (updated === null) throw new NotFoundError('Menu category assignment', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_category_assignment',
        entityId: id,
      });
      return updated;
    });
    this.announce('menu-category-assignments', Number(row.sync_seq));
    return mapMenuCategoryAssignment(row);
  }

  /** Refused while any menu item assignment still points at this category assignment. */
  async removeMenuCategoryAssignment(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await menuCategoryAssignmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu category assignment', id);

      const references = await menuCategoryAssignmentRepository.countItemReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `${references} item(s) on this menu still use this category; move or remove them first`,
        );
      }

      await menuCategoryAssignmentRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_category_assignment',
        entityId: id,
      });
    });
    this.announce('menu-category-assignments', 0);
  }

  /* ------------------------------------------------------------ menu item assignments */

  async listMenuItemAssignments(
    query: MenuMasterQuery & { menuId?: string; categoryAssignmentId?: string; availability?: AvailabilityStatus },
  ) {
    const paging = pagingFor(query);
    const filter: MenuItemAssignmentListFilter = {
      ...paging,
      ...(query.menuId !== undefined ? { menuId: query.menuId } : {}),
      ...(query.categoryAssignmentId !== undefined
        ? { categoryAssignmentId: query.categoryAssignmentId }
        : {}),
      ...(query.availability !== undefined ? { availability: query.availability } : {}),
    };
    const { rows, total } = await menuItemAssignmentRepository.list(getPool(), filter);
    return buildPage(rows.map(mapMenuItemAssignment), total, paging.page, paging.pageSize);
  }

  async getMenuItemAssignmentById(id: string) {
    const row = await menuItemAssignmentRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Menu item assignment', id);
    return mapMenuItemAssignment(row);
  }

  /** Assigns an existing Food Item (menu_items row) to a menu. Never creates a new food item. */
  async assignFoodItemToMenu(
    menuId: string,
    input: MenuItemAssignmentWriteRequest,
    actor: AuditActor,
  ) {
    const row = await withTransaction(async (connection) => {
      const menu = await menuRepository.findById(connection, menuId);
      if (menu === null) throw new NotFoundError('Menu', menuId);

      const foodItem = await menuItemRepository.findById(connection, input.foodItemId);
      if (foodItem === null) throw new NotFoundError('Food item', input.foodItemId);

      const existing = await menuItemAssignmentRepository.findByMenuAndFoodItem(
        connection,
        menuId,
        input.foodItemId,
      );
      if (existing !== null) {
        throw new ConflictError('This food item is already assigned to this menu');
      }

      const created = await menuItemAssignmentRepository.insert(connection, {
        id: input.id ?? newId(),
        menuId,
        foodItemId: input.foodItemId,
        categoryAssignmentId: input.categoryAssignmentId ?? null,
        displayName: input.displayName ?? null,
        displayNameHi: input.displayNameHi ?? null,
        description: input.description ?? null,
        descriptionHi: input.descriptionHi ?? null,
        preparationMethod: input.preparationMethod ?? null,
        preparationMethodHi: input.preparationMethodHi ?? null,
        preparationTimeMinutes: input.preparationTimeMinutes ?? null,
        unit: input.unit ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        availability: input.availability ?? 'AVAILABLE',
        sortOrder: input.sortOrder ?? 0,
        posVisible: input.posVisible ?? true,
        boardVisible: input.boardVisible ?? true,
        qrVisible: input.qrVisible ?? true,
        webVisible: input.webVisible ?? true,
        appVisible: input.appVisible ?? true,
        dineInAvailable: input.dineInAvailable ?? true,
        takeawayAvailable: input.takeawayAvailable ?? true,
        deliveryAvailable: input.deliveryAvailable ?? true,
        allowDecimalQuantity: input.allowDecimalQuantity ?? false,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_item_assignment',
        entityId: created.id,
        after: { menuId, foodItemId: input.foodItemId },
      });
      return created;
    });
    this.announce('menu-item-assignments', Number(row.sync_seq));
    return mapMenuItemAssignment(row);
  }

  async updateMenuItemAssignment(
    id: string,
    input: Partial<MenuItemAssignmentWriteRequest>,
    actor: AuditActor,
  ) {
    const row = await withTransaction(async (connection) => {
      const before = await menuItemAssignmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item assignment', id);

      const { foodItemId: _ignored, ...rest } = input;
      const updated = await menuItemAssignmentRepository.update(connection, id, rest);
      if (updated === null) throw new NotFoundError('Menu item assignment', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_item_assignment',
        entityId: id,
      });
      return updated;
    });
    this.announce('menu-item-assignments', Number(row.sync_seq));
    return mapMenuItemAssignment(row);
  }

  /** Refused while any order line still references a variant under this assignment. */
  async removeMenuItemAssignment(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await menuItemAssignmentRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item assignment', id);

      const references = await menuItemAssignmentRepository.countOrderReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          'This item has been ordered before and cannot be removed; deactivate it instead',
        );
      }

      await menuItemAssignmentRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_item_assignment',
        entityId: id,
      });
    });
    this.announce('menu-item-assignments', 0);
  }

  /* --------------------------------------------------------------- menu item variants */

  /** Variants belong to the Food Item Master, not any one menu — every menu offering this
   *  dish shows the same list. */
  async listVariants(foodItemId: string, includeInactive = false) {
    const rows = await menuItemVariantRepository.listForFoodItem(getPool(), foodItemId, includeInactive);
    return rows.map(mapMenuItemVariant);
  }

  async createVariant(
    foodItemId: string,
    input: MenuItemVariantWriteRequest,
    actor: AuditActor,
  ) {
    const row = await withTransaction(async (connection) => {
      const foodItem = await menuItemRepository.findById(connection, foodItemId);
      if (foodItem === null) throw new NotFoundError('Food item', foodItemId);

      const created = await menuItemVariantRepository.insert(connection, {
        id: input.id ?? newId(),
        foodItemId,
        variantCode: input.variantCode ?? null,
        name: input.name,
        nameHi: input.nameHi ?? null,
        description: input.description ?? null,
        descriptionHi: input.descriptionHi ?? null,
        portionName: input.portionName ?? null,
        portionNameHi: input.portionNameHi ?? null,
        quantity: input.quantity ?? null,
        unit: input.unit ?? null,
        price: input.price,
        taxProfileId: input.taxProfileId ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        availability: input.availability ?? 'AVAILABLE',
        sortOrder: input.sortOrder ?? 0,
        preparationMethod: input.preparationMethod ?? null,
        preparationMethodHi: input.preparationMethodHi ?? null,
        preparationTimeMinutes: input.preparationTimeMinutes ?? null,
        isDefault: input.isDefault ?? false,
        allowDecimalQuantity: input.allowDecimalQuantity ?? false,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_item_variant',
        entityId: created.id,
        after: { name: created.name, price: created.price },
      });
      return created;
    });
    this.announce('menu-item-variants', Number(row.sync_seq));
    return mapMenuItemVariant(row);
  }

  async updateVariant(id: string, input: Partial<MenuItemVariantWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await menuItemVariantRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item variant', id);

      const updated = await menuItemVariantRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Menu item variant', id);

      // A price change never touches an existing order line: order_items.unit_price /
      // variant_name are frozen at insert time in OrderRepository.insertItems and are never
      // re-derived from menu_item_variants afterwards.
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_item_variant',
        entityId: id,
        before: { price: before.price },
        after: { price: updated.price },
      });
      return updated;
    });
    this.announce('menu-item-variants', Number(row.sync_seq));
    return mapMenuItemVariant(row);
  }

  /** Refused while any order has ever sold this variant — deactivate instead. */
  async removeVariant(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await menuItemVariantRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item variant', id);

      const references = await menuItemVariantRepository.countOrderReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          'This variant has been ordered before and cannot be removed; deactivate it instead',
        );
      }

      await menuItemVariantRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_item_variant',
        entityId: id,
      });
    });
    this.announce('menu-item-variants', 0);
  }

  /* -------------------------------------------------------------------------- counters */

  async listCounters(query: MenuMasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await counterRepository.list(getPool(), filter);
    return buildPage(rows.map(mapCounter), total, filter.page, filter.pageSize);
  }

  async createCounter(input: CounterWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const created = await counterRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'counter',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    this.announce('counters', Number(row.sync_seq));
    return mapCounter(row);
  }

  async updateCounter(id: string, input: Partial<CounterWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await counterRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Counter', id);
      const updated = await counterRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Counter', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'counter',
        entityId: id,
      });
      return updated;
    });
    this.announce('counters', Number(row.sync_seq));
    return mapCounter(row);
  }

  async deleteCounter(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await counterRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Counter', id);
      const references = await counterRepository.countRouteReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `${references} menu item(s)/variant(s) still route to this counter; remove them first`,
        );
      }
      await counterRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'counter',
        entityId: id,
      });
    });
    this.announce('counters', 0);
  }

  async listCounterRoutes(entityType: RoutableEntityType, entityId: string) {
    const rows = await counterRouteRepository.listForEntity(getPool(), entityType, entityId);
    return rows.map(mapCounterRoute);
  }

  async assignCounterRoute(input: CounterRouteWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const counter = await counterRepository.findById(connection, input.counterId);
      if (counter === null) throw new NotFoundError('Counter', input.counterId);
      const created = await counterRouteRepository.insert(connection, {
        id: newId(),
        entityType: input.entityType,
        entityId: input.entityId,
        counterId: input.counterId,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'counter_route',
        entityId: created.id,
      });
      return created;
    });
    this.announce('counter-routes', Number(row.sync_seq));
    return mapCounterRoute(row);
  }

  async removeCounterRoute(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const removed = await counterRouteRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Counter route', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'counter_route',
        entityId: id,
      });
    });
    this.announce('counter-routes', 0);
  }

  /* ------------------------------------------------------------------- item groups */

  async listItemGroups(query: MenuMasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await itemGroupRepository.list(getPool(), filter);
    return buildPage(rows.map(mapItemGroup), total, filter.page, filter.pageSize);
  }

  async createItemGroup(input: ItemGroupWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const created = await itemGroupRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'item_group',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    this.announce('item-groups', Number(row.sync_seq));
    return mapItemGroup(row);
  }

  async updateItemGroup(id: string, input: Partial<ItemGroupWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await itemGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Item group', id);
      const updated = await itemGroupRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Item group', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'item_group',
        entityId: id,
      });
      return updated;
    });
    this.announce('item-groups', Number(row.sync_seq));
    return mapItemGroup(row);
  }

  async deleteItemGroup(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await itemGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Item group', id);
      const references = await itemGroupRepository.countAssignmentReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `${references} food item(s) are still assigned to this group; remove them first`,
        );
      }
      await itemGroupRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'item_group',
        entityId: id,
      });
    });
    this.announce('item-groups', 0);
  }

  async listItemGroupsForFoodItem(foodItemId: string) {
    const rows = await itemGroupAssignmentRepository.listForFoodItem(getPool(), foodItemId);
    return rows.map(mapItemGroupAssignment);
  }

  async assignItemGroup(input: ItemGroupAssignmentWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const foodItem = await menuItemRepository.findById(connection, input.foodItemId);
      if (foodItem === null) throw new NotFoundError('Menu item', input.foodItemId);
      const group = await itemGroupRepository.findById(connection, input.groupId);
      if (group === null) throw new NotFoundError('Item group', input.groupId);
      const created = await itemGroupAssignmentRepository.insert(connection, {
        id: newId(),
        foodItemId: input.foodItemId,
        groupId: input.groupId,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'item_group_assignment',
        entityId: created.id,
      });
      return created;
    });
    this.announce('item-group-assignments', Number(row.sync_seq));
    return mapItemGroupAssignment(row);
  }

  async removeItemGroupAssignment(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const removed = await itemGroupAssignmentRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Item group assignment', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'item_group_assignment',
        entityId: id,
      });
    });
    this.announce('item-group-assignments', 0);
  }

  /* -------------------------------------------------------------- food item schedules */

  async getMenuItemSchedule(foodItemId: string): Promise<MenuItemScheduleBulkResponse> {
    const pool = getPool();
    const foodItem = await menuItemRepository.findById(pool, foodItemId);
    if (foodItem === null) throw new NotFoundError('Menu item', foodItemId);
    const rows = await menuItemScheduleRepository.listForFoodItem(pool, foodItemId);
    return {
      alwaysAvailable: foodItem.always_available === 1,
      slots: rows.map(mapMenuItemSchedule),
    };
  }

  async setMenuItemSchedule(
    foodItemId: string,
    input: MenuItemScheduleBulkWriteRequest,
    actor: AuditActor,
  ): Promise<MenuItemScheduleBulkResponse> {
    const result = await withTransaction(async (connection) => {
      const foodItem = await menuItemRepository.findById(connection, foodItemId);
      if (foodItem === null) throw new NotFoundError('Menu item', foodItemId);

      await menuItemRepository.update(connection, foodItemId, {
        alwaysAvailable: input.alwaysAvailable,
      });
      const rows = await menuItemScheduleRepository.replaceForFoodItem(
        connection,
        foodItemId,
        input.slots,
        actor.userId,
      );
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_item_schedule',
        entityId: foodItemId,
        after: { alwaysAvailable: input.alwaysAvailable, slotCount: input.slots.length },
      });
      return rows;
    });
    this.announce('menu-item-schedules', 0);
    return { alwaysAvailable: input.alwaysAvailable, slots: result.map(mapMenuItemSchedule) };
  }

  /* ------------------------------------------------------ variant catalogue pricing */

  async listVariantCatalogPrices(variantId: string) {
    const rows = await menuItemVariantCatalogPriceRepository.listForVariant(getPool(), variantId);
    return rows.map(mapVariantCatalogPrice);
  }

  async setVariantCatalogPrice(
    variantId: string,
    input: MenuItemVariantCatalogPriceWriteRequest,
    actor: AuditActor,
  ) {
    await withTransaction(async (connection) => {
      const variant = await menuItemVariantRepository.findById(connection, variantId);
      if (variant === null) throw new NotFoundError('Menu item variant', variantId);
      const menu = await menuRepository.findById(connection, input.menuId);
      if (menu === null) throw new NotFoundError('Menu', input.menuId);

      if (input.price === null) {
        await menuItemVariantCatalogPriceRepository.removeForMenu(connection, variantId, input.menuId);
        await auditService.record(connection, actor, {
          action: AuditAction.MASTER_DELETED,
          entityType: 'menu_item_variant_catalog_price',
          entityId: `${variantId}:${input.menuId}`,
        });
        return;
      }

      const created = await menuItemVariantCatalogPriceRepository.upsert(connection, {
        id: newId(),
        variantId,
        menuId: input.menuId,
        price: input.price,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_item_variant_catalog_price',
        entityId: created.id,
        after: { price: input.price },
      });
    });
    this.announce('menu-item-variant-catalog-prices', 0);
    return this.listVariantCatalogPrices(variantId);
  }

  /* -------------------------------------------------------------------- printing groups */

  async listPrintingGroups(query: MenuMasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await printingGroupRepository.list(getPool(), filter);
    return buildPage(rows.map(mapPrintingGroup), total, filter.page, filter.pageSize);
  }

  async createPrintingGroup(input: PrintingGroupWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const created = await printingGroupRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'printing_group',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    this.announce('printing-groups', Number(row.sync_seq));
    return mapPrintingGroup(row);
  }

  async updatePrintingGroup(id: string, input: Partial<PrintingGroupWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await printingGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Printing group', id);
      const updated = await printingGroupRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Printing group', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'printing_group',
        entityId: id,
      });
      return updated;
    });
    this.announce('printing-groups', Number(row.sync_seq));
    return mapPrintingGroup(row);
  }

  async deletePrintingGroup(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await printingGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Printing group', id);
      const references = await printingGroupRepository.countRouteReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `${references} menu item(s)/variant(s) still route to this printing group; remove them first`,
        );
      }
      await printingGroupRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'printing_group',
        entityId: id,
      });
    });
    this.announce('printing-groups', 0);
  }

  async listPrintingRoutes(entityType: RoutableEntityType, entityId: string) {
    const rows = await printingRouteRepository.listForEntity(getPool(), entityType, entityId);
    return rows.map(mapPrintingRoute);
  }

  async assignPrintingRoute(input: PrintingRouteWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const group = await printingGroupRepository.findById(connection, input.printingGroupId);
      if (group === null) throw new NotFoundError('Printing group', input.printingGroupId);
      const created = await printingRouteRepository.insert(connection, {
        id: newId(),
        entityType: input.entityType,
        entityId: input.entityId,
        printingGroupId: input.printingGroupId,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'printing_route',
        entityId: created.id,
      });
      return created;
    });
    this.announce('printing-routes', Number(row.sync_seq));
    return mapPrintingRoute(row);
  }

  async removePrintingRoute(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const removed = await printingRouteRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Printing route', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'printing_route',
        entityId: id,
      });
    });
    this.announce('printing-routes', 0);
  }

  /* ------------------------------------------------------------------------- modifiers */

  async listModifierGroups(query: MenuMasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await modifierGroupRepository.list(getPool(), filter);
    const groups = await Promise.all(
      rows.map(async (row) => {
        const modifiers = await modifierRepository.listForGroup(getPool(), row.id);
        return { ...mapModifierGroup(row), modifiers: modifiers.map(mapModifier) };
      }),
    );
    return buildPage(groups, total, filter.page, filter.pageSize);
  }

  async createModifierGroup(input: ModifierGroupWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const created = await modifierGroupRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        description: input.description ?? null,
        selectionType: input.selectionType ?? 'MULTIPLE',
        minSelect: input.minSelect ?? 0,
        maxSelect: input.maxSelect ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'modifier_group',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    this.announce('modifier-groups', Number(row.sync_seq));
    return mapModifierGroup(row);
  }

  async updateModifierGroup(id: string, input: Partial<ModifierGroupWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await modifierGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Modifier group', id);
      const updated = await modifierGroupRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Modifier group', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'modifier_group',
        entityId: id,
      });
      return updated;
    });
    this.announce('modifier-groups', Number(row.sync_seq));
    return mapModifierGroup(row);
  }

  async deleteModifierGroup(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await modifierGroupRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Modifier group', id);
      await modifierGroupRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'modifier_group',
        entityId: id,
      });
    });
    this.announce('modifier-groups', 0);
  }

  async createModifier(groupId: string, input: ModifierWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const group = await modifierGroupRepository.findById(connection, groupId);
      if (group === null) throw new NotFoundError('Modifier group', groupId);
      const created = await modifierRepository.insert(connection, {
        id: input.id ?? newId(),
        modifierGroupId: groupId,
        name: input.name,
        nameHi: input.nameHi ?? null,
        priceDelta: input.priceDelta ?? 0,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'modifier',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    this.announce('modifiers', Number(row.sync_seq));
    return mapModifier(row);
  }

  async updateModifier(id: string, input: Partial<ModifierWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await modifierRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Modifier', id);
      const updated = await modifierRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Modifier', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'modifier',
        entityId: id,
      });
      return updated;
    });
    this.announce('modifiers', Number(row.sync_seq));
    return mapModifier(row);
  }

  async deleteModifier(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const before = await modifierRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Modifier', id);
      await modifierRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'modifier',
        entityId: id,
      });
    });
    this.announce('modifiers', 0);
  }

  async listModifierAssignments(entityType: RoutableEntityType, entityId: string) {
    const rows = await modifierAssignmentRepository.listForEntity(getPool(), entityType, entityId);
    return rows.map(mapModifierAssignment);
  }

  async assignModifierGroup(input: ModifierAssignmentWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const group = await modifierGroupRepository.findById(connection, input.modifierGroupId);
      if (group === null) throw new NotFoundError('Modifier group', input.modifierGroupId);
      const created = await modifierAssignmentRepository.insert(connection, {
        id: newId(),
        entityType: input.entityType,
        entityId: input.entityId,
        modifierGroupId: input.modifierGroupId,
        isRequired: input.isRequired ?? false,
        sortOrder: input.sortOrder ?? 0,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'modifier_assignment',
        entityId: created.id,
      });
      return created;
    });
    this.announce('modifier-assignments', Number(row.sync_seq));
    return mapModifierAssignment(row);
  }

  async removeModifierAssignment(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const removed = await modifierAssignmentRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Modifier assignment', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'modifier_assignment',
        entityId: id,
      });
    });
    this.announce('modifier-assignments', 0);
  }

  /* --------------------------------------------------------------------- menu schedules */

  async listSchedules(menuId: string) {
    const rows = await menuScheduleRepository.listForMenu(getPool(), menuId);
    return rows.map(mapMenuSchedule);
  }

  async createSchedule(menuId: string, input: MenuScheduleWriteRequest, actor: AuditActor) {
    if (input.startTime >= input.endTime) {
      throw new ValidationError('Schedule start time must be before its end time', [
        { path: 'endTime', message: 'Must be after the start time' },
      ]);
    }
    const row = await withTransaction(async (connection) => {
      const menu = await menuRepository.findById(connection, menuId);
      if (menu === null) throw new NotFoundError('Menu', menuId);
      const created = await menuScheduleRepository.insert(connection, {
        id: input.id ?? newId(),
        menuId,
        dayOfWeek: input.dayOfWeek ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_schedule',
        entityId: created.id,
      });
      return created;
    });
    this.announce('menu-schedules', Number(row.sync_seq));
    return mapMenuSchedule(row);
  }

  async updateSchedule(id: string, input: Partial<MenuScheduleWriteRequest>, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const before = await menuScheduleRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu schedule', id);
      const updated = await menuScheduleRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Menu schedule', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_schedule',
        entityId: id,
      });
      return updated;
    });
    this.announce('menu-schedules', Number(row.sync_seq));
    return mapMenuSchedule(row);
  }

  async removeSchedule(id: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const removed = await menuScheduleRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Menu schedule', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_schedule',
        entityId: id,
      });
    });
    this.announce('menu-schedules', 0);
  }

  /* -------------------------------------------------------- POS / MenuBoard resolution */

  /**
   * The full tree a POS or MenuBoard client requests for one published menu: categories ->
   * items -> variants, each carrying its resolved primary media (variant -> item -> food item,
   * first non-null wins, never duplicating the file) and routing/modifier ids. Unpublished or
   * inactive menus resolve to null so a caller cannot accidentally serve a draft.
   */
  async getMenuTree(menuCode: string, userId: string): Promise<MenuTreeDto> {
    const pool = getPool();
    const menu = await menuRepository.findByCode(pool, menuCode);
    if (menu === null || menu.status !== MasterStatus.ACTIVE || menu.published_at === null) {
      throw new NotFoundError('Menu', menuCode);
    }

    const categoryAssignments = await menuCategoryAssignmentRepository.listForMenu(pool, menu.id, false);
    const itemAssignments = (
      await menuItemAssignmentRepository.list(pool, {
        menuId: menu.id,
        status: MasterStatus.ACTIVE,
        limit: 1000,
        offset: 0,
      })
    ).rows;

    const uniqueFoodItemIds = [...new Set(itemAssignments.map((a) => a.food_item_id))];
    const variantsByFoodItem = new Map(
      await Promise.all(
        uniqueFoodItemIds.map(async (foodItemId) => {
          const variants = await menuItemVariantRepository.listForFoodItem(pool, foodItemId, false);
          return [foodItemId, variants] as const;
        }),
      ),
    );

    const menuMedia = await mediaAssignmentRepository.findPrimaryForEntities(pool, 'MENU' as MediaEntityType, [
      menu.id,
    ]);
    const categoryMedia = await mediaAssignmentRepository.findPrimaryForEntities(
      pool,
      'MENU_CATEGORY_ASSIGNMENT' as MediaEntityType,
      categoryAssignments.map((c) => c.id),
    );
    const itemMedia = await mediaAssignmentRepository.findPrimaryForEntities(
      pool,
      'MENU_ITEM_ASSIGNMENT' as MediaEntityType,
      itemAssignments.map((i) => i.id),
    );
    const allVariantIds = [...variantsByFoodItem.values()].flat().map((v) => v.id);
    const variantMedia = await mediaAssignmentRepository.findPrimaryForEntities(
      pool,
      'MENU_ITEM_VARIANT' as MediaEntityType,
      allVariantIds,
    );
    // Photography attached to the food item itself, shared by every menu that offers it. It
    // sits below the per-menu levels in the fallback chain and above the legacy image_path.
    const foodItemMedia = await mediaAssignmentRepository.findPrimaryForEntities(
      pool,
      'MENU_ITEM' as MediaEntityType,
      uniqueFoodItemIds,
    );

    // `findPrimaryForEntities` returns the media asset id, not a path — signing is the only
    // way to reach it, since `/media/:id/file` requires a time-limited signature. There is no
    // working unsigned static route, so a legacy `image_path` with no assignment renders
    // nothing rather than a broken `<img>`.
    const toUrl = (mediaId: string | undefined): string | null =>
      mediaId ? signMenuMediaUrl(mediaId, userId) : null;

    // An item can be assigned to a menu without being placed in any category on it — the
    // assignment form does not require one. Dropping such an item from the tree would make it
    // sellable in Menu Master but invisible everywhere the tree is the only read path (the
    // POS), so it surfaces here as an "Uncategorized" bucket rather than disappearing.
    const buildItem = (item: (typeof itemAssignments)[number]): ResolvedMenuItemDto => {
      const variants = (variantsByFoodItem.get(item.food_item_id) ?? []).map(
        (variant): ResolvedMenuVariantDto => ({
          id: variant.id,
          variantCode: variant.variant_code,
          name: variant.name,
          nameHi: variant.name_hi,
          portionName: variant.portion_name,
          quantity: variant.quantity === null ? null : Number(variant.quantity),
          unit: variant.unit,
          price: Number(variant.price),
          availability: variant.availability,
          sortOrder: variant.sort_order,
          primaryMediaUrl:
            toUrl(variantMedia.get(variant.id)) ??
            toUrl(itemMedia.get(item.id)) ??
            toUrl(foodItemMedia.get(item.food_item_id)),
          allowDecimalQuantity: variant.allow_decimal_quantity === 1,
          counters: [],
          printingGroups: [],
          modifierGroupIds: [],
        }),
      );
      return {
        id: item.id,
        foodItemId: item.food_item_id,
        name: item.display_name ?? item.food_item_name ?? '',
        nameHi: item.display_name_hi ?? item.food_item_name_hi ?? null,
        description: item.description,
        unit: item.unit ?? item.food_item_unit ?? 'NOS',
        availability: item.availability,
        sortOrder: item.sort_order,
        primaryMediaUrl: toUrl(itemMedia.get(item.id)) ?? toUrl(foodItemMedia.get(item.food_item_id)),
        allowDecimalQuantity: item.allow_decimal_quantity === 1,
        basePrice:
          item.food_item_base_price === null || item.food_item_base_price === undefined
            ? null
            : Number(item.food_item_base_price),
        variants,
        posVisible: item.pos_visible === 1,
        boardVisible: item.board_visible === 1,
        qrVisible: item.qr_visible === 1,
        webVisible: item.web_visible === 1,
        appVisible: item.app_visible === 1,
      };
    };

    const categories: ResolvedMenuCategoryDto[] = categoryAssignments.map((category) => ({
      id: category.id,
      categoryId: category.category_id,
      name: category.display_name ?? category.category_name ?? '',
      nameHi: category.display_name_hi ?? category.category_name_hi ?? null,
      sortOrder: category.sort_order,
      primaryMediaUrl: toUrl(categoryMedia.get(category.id)),
      items: itemAssignments
        .filter((item) => item.category_assignment_id === category.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(buildItem),
    }));

    const uncategorized = itemAssignments
      .filter((item) => item.category_assignment_id === null)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(buildItem);
    if (uncategorized.length > 0) {
      categories.push({
        id: `${menu.id}:uncategorized`,
        categoryId: `${menu.id}:uncategorized`,
        name: 'Uncategorized',
        nameHi: null,
        sortOrder: Number.MAX_SAFE_INTEGER,
        primaryMediaUrl: null,
        items: uncategorized,
      });
    }

    return {
      id: menu.id,
      code: menu.code,
      name: menu.name,
      description: menu.description,
      primaryMediaUrl: toUrl(menuMedia.get(menu.id)),
      categories,
    };
  }

  /**
   * Menu Master is not (yet) part of the Android offline-sync entity set (`SYNC_ENTITIES` in
   * shared/src/sync), so there is nothing to broadcast through `realtime.emitMasterChange`,
   * which only accepts that closed union. The Admin Portal picks up changes the same way every
   * other list in it already does: refetching after a mutation. Kept as a named seam so wiring
   * this into sync/realtime later touches one place.
   */
  private announce(_entity: string, _syncSeq: number): void {
    // Intentionally empty for now — see comment above.
  }
}

export const menuMasterService = new MenuMasterService();
