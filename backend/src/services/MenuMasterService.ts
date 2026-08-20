import {
  MasterStatus,
  type ActiveMenuDto,
  type ActiveMenusDto,
  type AvailabilityStatus,
  type CounterRouteMoveRequest,
  type CounterRouteWriteRequest,
  type CounterWriteRequest,
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
  type ModifierAssignmentMoveRequest,
  type ModifierAssignmentWriteRequest,
  type ModifierGroupWriteRequest,
  type ModifierWriteRequest,
  type PrintingGroupWriteRequest,
  type PrintingRouteMoveRequest,
  type PrintingRouteWriteRequest,
  type ResolvedMenuCategoryDto,
  type ResolvedMenuItemDto,
  type ResolvedMenuVariantDto,
  type RoutableEntityType,
  type UpcomingMenuDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import {
  mapCounter,
  mapCounterRoute,
  mapItemGroup,
  mapMenu,
  mapMenuCategoryAssignment,
  mapMenuItem,
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
  type MenuScheduleWindowRow,
} from '../repositories/MenuMasterRepository';
import { mediaAssignmentRepository } from '../repositories/MediaRepository';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import type { Db } from '../db/types';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { signMenuMediaUrl } from '../utils/mediaStorage';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { fromDbTime, localIsoDate } from '../utils/time';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface MenuMasterQuery {
  search?: string;
  status?: MasterStatus;
  /** Only honoured by tables carrying `catalogue_id` (item_groups); `null` means unfiled. */
  catalogueId?: string | null;
  page?: number;
  pageSize?: number;
}

/** One of a menu's schedule windows for today, in both the wire and the arithmetic form. */
interface ScheduleWindow {
  startTime: string;
  endTime: string;
  startsAt: number;
  endsAt: number;
}

/** 'HH:MM:SS' from a TIME column to seconds since local midnight. */
function clockSeconds(value: string): number {
  return Number(value.slice(0, 2)) * 3600 + Number(value.slice(3, 5)) * 60;
}

/** Never negative: a window that closed while the request was in flight reads as 0, not -1. */
function wholeMinutesUntil(targetSeconds: number, nowSeconds: number): number {
  return Math.max(0, Math.floor((targetSeconds - nowSeconds) / 60));
}

function pagingFor(query: MenuMasterQuery): MasterListFilter & { page: number; pageSize: number } {
  const { page, pageSize, offset } = resolvePaging(query);
  return {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.catalogueId !== undefined ? { catalogueId: query.catalogueId } : {}),
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
  private async assertRoutableEntity(
    db: Db,
    entityType: RoutableEntityType,
    entityId: string,
  ): Promise<void> {
    const entity =
      entityType === 'MENU_ITEM'
        ? await menuItemRepository.findById(db, entityId)
        : entityType === 'MENU_ITEM_ASSIGNMENT'
          ? await menuItemAssignmentRepository.findById(db, entityId)
          : await menuItemVariantRepository.findById(db, entityId);
    if (entity === null) throw new NotFoundError('Assignment target', entityId);
  }

  async getMenuAssignmentWorkspace(userId: string) {
    const pool = getPool();
    const filter = { status: MasterStatus.ACTIVE, limit: 100_000, offset: 0 };
    const [items, counters, kitchens, groups, counterRoutes, printingRoutes, modifierAssignments] =
      await Promise.all([
        menuItemRepository.list(pool, filter),
        counterRepository.list(pool, filter),
        printingGroupRepository.list(pool, filter),
        modifierGroupRepository.list(pool, filter),
        counterRouteRepository.listForEntityType(pool, 'MENU_ITEM'),
        printingRouteRepository.listForEntityType(pool, 'MENU_ITEM'),
        modifierAssignmentRepository.listForEntityType(pool, 'MENU_ITEM'),
      ]);
    const modifierGroups = await Promise.all(
      groups.rows.map(async (group) => ({
        ...mapModifierGroup(group),
        modifiers: (await modifierRepository.listForGroup(pool, group.id)).map(mapModifier),
      })),
    );
    return {
      menuItems: items.rows.map((item) => mapMenuItem(item, userId)),
      counters: counters.rows.map(mapCounter),
      kitchens: kitchens.rows.map(mapPrintingGroup),
      modifierGroups,
      counterRoutes: counterRoutes.map(mapCounterRoute),
      printingRoutes: printingRoutes.map(mapPrintingRoute),
      modifierAssignments: modifierAssignments.map(mapModifierAssignment),
    };
  }

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
      if (input.categoryAssignmentId) {
        const category = await menuCategoryAssignmentRepository.findById(
          connection,
          input.categoryAssignmentId,
        );
        if (category === null || category.menu_id !== menuId) {
          throw new ValidationError('The selected category does not belong to this menu');
        }
      }

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
      if (input.categoryAssignmentId) {
        const category = await menuCategoryAssignmentRepository.findById(
          connection,
          input.categoryAssignmentId,
        );
        if (category === null || category.menu_id !== before.menu_id) {
          throw new ValidationError('The selected category does not belong to this menu');
        }
      }

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

      await counterRouteRepository.softDeleteForEntity(connection, 'MENU_ITEM_ASSIGNMENT', id);
      await printingRouteRepository.softDeleteForEntity(connection, 'MENU_ITEM_ASSIGNMENT', id);
      await modifierAssignmentRepository.softDeleteForEntity(connection, 'MENU_ITEM_ASSIGNMENT', id);
      await mediaAssignmentRepository.softDeleteForEntity(connection, 'MENU_ITEM_ASSIGNMENT', id);
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

      await counterRouteRepository.softDeleteForEntity(connection, 'MENU_ITEM_VARIANT', id);
      await printingRouteRepository.softDeleteForEntity(connection, 'MENU_ITEM_VARIANT', id);
      await modifierAssignmentRepository.softDeleteForEntity(connection, 'MENU_ITEM_VARIANT', id);
      await mediaAssignmentRepository.softDeleteForEntity(connection, 'MENU_ITEM_VARIANT', id);
      await menuItemVariantCatalogPriceRepository.softDeleteForVariants(connection, [id]);
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
      await counterRouteRepository.softDeleteForCounter(connection, id);
      await mediaAssignmentRepository.softDeleteForEntity(connection, 'COUNTER', id);
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
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
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

  async moveCounterRoute(input: CounterRouteMoveRequest, actor: AuditActor) {
    if (!input.sourceRouteId && !input.targetCounterId) {
      throw new ValidationError('A source assignment or target counter is required');
    }
    await withTransaction(async (connection) => {
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
      const source = input.sourceRouteId
        ? await counterRouteRepository.findById(connection, input.sourceRouteId)
        : null;
      if (source && (source.entity_type !== input.entityType || source.entity_id !== input.entityId)) {
        throw new ValidationError('The source counter assignment does not belong to this menu item');
      }
      let targetId = source?.id ?? input.entityId;
      if (input.targetCounterId) {
        const counter = await counterRepository.findById(connection, input.targetCounterId);
        if (counter === null) throw new NotFoundError('Counter', input.targetCounterId);
        const target = await counterRouteRepository.insert(connection, {
          id: newId(),
          entityType: input.entityType,
          entityId: input.entityId,
          counterId: input.targetCounterId,
          status: MasterStatus.ACTIVE,
          createdBy: actor.userId,
        });
        targetId = target.id;
      }
      if (source && source.counter_id !== input.targetCounterId) {
        await counterRouteRepository.softDelete(connection, source.id);
      }
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'counter_route',
        entityId: targetId,
      });
    });
    this.announce('counter-routes', 0);
    return (await counterRouteRepository.listForEntity(getPool(), input.entityType, input.entityId)).map(
      mapCounterRoute,
    );
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

  /**
   * A Menu Group names the Menu Catalogue it belongs to, so the id has to be a real menu.
   * Unlike a category there is no derived assignment row to keep in step: nothing outside
   * `item_groups.catalogue_id` records which catalogue a group is on.
   */
  private async assertCatalogueExists(db: Db, catalogueId: string | null): Promise<void> {
    if (catalogueId === null) return;
    const menu = await menuRepository.findById(db, catalogueId);
    if (menu === null) throw new NotFoundError('Menu catalogue', catalogueId);
  }

  async createItemGroup(input: ItemGroupWriteRequest, actor: AuditActor) {
    const row = await withTransaction(async (connection) => {
      const catalogueId = input.catalogueId ?? null;
      await this.assertCatalogueExists(connection, catalogueId);
      const created = await itemGroupRepository.insert(connection, {
        id: input.id ?? newId(),
        catalogueId,
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
        after: { name: created.name, catalogueId },
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
      if (input.catalogueId !== undefined) {
        await this.assertCatalogueExists(connection, input.catalogueId);
      }
      const updated = await itemGroupRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Item group', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'item_group',
        entityId: id,
        before: { catalogueId: before.catalogue_id },
        after: { catalogueId: updated.catalogue_id },
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
      const references = await itemGroupRepository.countItemReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `${references} food item(s) are still filed under this group; reassign or remove them first`,
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
      await printingRouteRepository.softDeleteForPrintingGroup(connection, id);
      await mediaAssignmentRepository.softDeleteForEntity(connection, 'PRINTING_GROUP', id);
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
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
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

  async movePrintingRoute(input: PrintingRouteMoveRequest, actor: AuditActor) {
    if (!input.sourceRouteId && !input.targetPrintingGroupId) {
      throw new ValidationError('A source assignment or target kitchen is required');
    }
    await withTransaction(async (connection) => {
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
      const source = input.sourceRouteId
        ? await printingRouteRepository.findById(connection, input.sourceRouteId)
        : null;
      if (source && (source.entity_type !== input.entityType || source.entity_id !== input.entityId)) {
        throw new ValidationError('The source kitchen assignment does not belong to this menu item');
      }
      let targetId = source?.id ?? input.entityId;
      if (input.targetPrintingGroupId) {
        const group = await printingGroupRepository.findById(connection, input.targetPrintingGroupId);
        if (group === null) throw new NotFoundError('Printing group', input.targetPrintingGroupId);
        const target = await printingRouteRepository.insert(connection, {
          id: newId(),
          entityType: input.entityType,
          entityId: input.entityId,
          printingGroupId: input.targetPrintingGroupId,
          sortOrder: source?.sort_order ?? 0,
          status: MasterStatus.ACTIVE,
          createdBy: actor.userId,
        });
        targetId = target.id;
      }
      if (source && source.printing_group_id !== input.targetPrintingGroupId) {
        await printingRouteRepository.softDelete(connection, source.id);
      }
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'printing_route',
        entityId: targetId,
      });
    });
    this.announce('printing-routes', 0);
    return (await printingRouteRepository.listForEntity(getPool(), input.entityType, input.entityId)).map(
      mapPrintingRoute,
    );
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
    const minSelect = input.minSelect ?? 0;
    const maxSelect = input.maxSelect ?? null;
    if (maxSelect !== null && minSelect > maxSelect) {
      throw new ValidationError('Minimum selections cannot exceed maximum selections');
    }
    const row = await withTransaction(async (connection) => {
      const created = await modifierGroupRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        description: input.description ?? null,
        selectionType: input.selectionType ?? 'MULTIPLE',
        minSelect,
        maxSelect,
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
      const minSelect = input.minSelect ?? Number(before.min_select);
      const maxSelect = input.maxSelect === undefined ? before.max_select : input.maxSelect;
      if (maxSelect !== null && minSelect > Number(maxSelect)) {
        throw new ValidationError('Minimum selections cannot exceed maximum selections');
      }
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
      await modifierAssignmentRepository.softDeleteForModifierGroup(connection, id);
      await modifierRepository.softDeleteForGroup(connection, id);
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
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
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

  async moveModifierAssignment(input: ModifierAssignmentMoveRequest, actor: AuditActor) {
    if (!input.sourceAssignmentId && !input.targetModifierGroupId) {
      throw new ValidationError('A source assignment or target modifier group is required');
    }
    await withTransaction(async (connection) => {
      await this.assertRoutableEntity(connection, input.entityType, input.entityId);
      const source = input.sourceAssignmentId
        ? await modifierAssignmentRepository.findById(connection, input.sourceAssignmentId)
        : null;
      if (source && (source.entity_type !== input.entityType || source.entity_id !== input.entityId)) {
        throw new ValidationError('The source modifier assignment does not belong to this menu item');
      }
      let targetId = source?.id ?? input.entityId;
      if (input.targetModifierGroupId) {
        const group = await modifierGroupRepository.findById(connection, input.targetModifierGroupId);
        if (group === null) throw new NotFoundError('Modifier group', input.targetModifierGroupId);
        const target = await modifierAssignmentRepository.insert(connection, {
          id: newId(),
          entityType: input.entityType,
          entityId: input.entityId,
          modifierGroupId: input.targetModifierGroupId,
          isRequired: source?.is_required === 1,
          sortOrder: source?.sort_order ?? 0,
          status: MasterStatus.ACTIVE,
          createdBy: actor.userId,
        });
        targetId = target.id;
      }
      if (source && source.modifier_group_id !== input.targetModifierGroupId) {
        await modifierAssignmentRepository.softDelete(connection, source.id);
      }
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'modifier_assignment',
        entityId: targetId,
      });
    });
    this.announce('modifier-assignments', 0);
    return (
      await modifierAssignmentRepository.listForEntity(getPool(), input.entityType, input.entityId)
    ).map(mapModifierAssignment);
  }

  async removeMenuItemModifierGroupAssignments(modifierGroupId: string, actor: AuditActor) {
    await withTransaction(async (connection) => {
      const group = await modifierGroupRepository.findById(connection, modifierGroupId);
      if (group === null) throw new NotFoundError('Modifier group', modifierGroupId);
      await modifierAssignmentRepository.softDeleteForModifierGroup(
        connection,
        modifierGroupId,
        'MENU_ITEM',
      );
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'modifier_assignment_group',
        entityId: modifierGroupId,
      });
    });
    this.announce('modifier-assignments', 0);
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

  /**
   * Which menus are servable at this instant, and which of the rest open later today.
   *
   * The whole answer hangs off one reading of the clock: a request that straddled midnight
   * could otherwise be resolved against yesterday's date and today's weekday.
   */
  async activeMenus(): Promise<ActiveMenusDto> {
    const now = new Date();
    const weekday = now.getDay();
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    const rows = await menuRepository.listScheduleWindows(getPool(), {
      today: localIsoDate(now),
      weekday,
    });

    const active: ActiveMenuDto[] = [];
    const next: UpcomingMenuDto[] = [];

    // One row per window, already ordered by priority then name, so grouping by insertion order
    // preserves the order the DTO promises for `active`. A menu closed today contributes a row
    // with no window at all, which is why the windows list can end up empty.
    const byMenu = new Map<string, { menu: MenuScheduleWindowRow; windows: ScheduleWindow[] }>();
    for (const row of rows) {
      const entry = byMenu.get(row.id) ?? { menu: row, windows: [] };
      if (row.start_time !== null && row.end_time !== null) {
        entry.windows.push({
          startTime: fromDbTime(row.start_time) as string,
          endTime: fromDbTime(row.end_time) as string,
          startsAt: clockSeconds(row.start_time),
          endsAt: clockSeconds(row.end_time),
        });
      }
      byMenu.set(row.id, entry);
    }

    for (const { menu, windows } of byMenu.values()) {
      if (Number(menu.has_schedule) === 0) {
        active.push({
          id: menu.id,
          code: menu.code,
          name: menu.name,
          priority: Number(menu.priority),
          startTime: null,
          endTime: null,
          endsInMinutes: null,
        });
        continue;
      }

      // Overlapping windows are legal, and the menu stays open until the last of them closes.
      const open = windows
        .filter((window) => window.startsAt <= nowSeconds && nowSeconds < window.endsAt)
        .sort((a, b) => b.endsAt - a.endsAt)[0];

      if (open !== undefined) {
        active.push({
          id: menu.id,
          code: menu.code,
          name: menu.name,
          priority: Number(menu.priority),
          startTime: open.startTime,
          endTime: open.endTime,
          endsInMinutes: wholeMinutesUntil(open.endsAt, nowSeconds),
        });
        continue;
      }

      const upcoming = windows
        .filter((window) => window.startsAt > nowSeconds)
        .sort((a, b) => a.startsAt - b.startsAt)[0];

      if (upcoming !== undefined) {
        next.push({
          id: menu.id,
          code: menu.code,
          name: menu.name,
          startTime: upcoming.startTime,
          startsInMinutes: wholeMinutesUntil(upcoming.startsAt, nowSeconds),
        });
      }
    }

    next.sort((a, b) => a.startsInMinutes - b.startsInMinutes);

    return { asOf: now.toISOString(), weekday, active, next };
  }

  /* -------------------------------------------------------- POS / MenuBoard resolution */

  /**
   * The full tree a POS or MenuBoard client requests for one published menu: categories ->
   * items -> variants, each carrying its resolved primary media (variant -> item -> food item,
   * first non-null wins, never duplicating the file) and routing/modifier ids. Unpublished or
   * inactive menus resolve to null so a caller cannot accidentally serve a draft.
   *
   * @param mediaUrlFor how a resolved media id becomes a URL. Defaults to the signed, expiring
   *   link every authenticated client uses. The Digital Menu Board passes its own builder
   *   instead: a wall screen holds one page open for days, so a URL that expires in two hours
   *   would blank its photography — and re-signing on every poll would make every URL differ,
   *   which defeats change detection and churns every `<img>` on the board.
   */
  async getMenuTree(
    menuCode: string,
    userId: string,
    mediaUrlFor: (mediaId: string) => string = (mediaId) => signMenuMediaUrl(mediaId, userId),
  ): Promise<MenuTreeDto> {
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
    const [foodCounterRoutes, itemCounterRoutes, variantCounterRoutes, foodPrintingRoutes,
      itemPrintingRoutes, variantPrintingRoutes, foodModifierAssignments, itemModifierAssignments,
      variantModifierAssignments] = await Promise.all([
        counterRouteRepository.listForEntities(pool, 'MENU_ITEM', uniqueFoodItemIds),
        counterRouteRepository.listForEntities(pool, 'MENU_ITEM_ASSIGNMENT', itemAssignments.map((item) => item.id)),
        counterRouteRepository.listForEntities(pool, 'MENU_ITEM_VARIANT', allVariantIds),
        printingRouteRepository.listForEntities(pool, 'MENU_ITEM', uniqueFoodItemIds),
        printingRouteRepository.listForEntities(pool, 'MENU_ITEM_ASSIGNMENT', itemAssignments.map((item) => item.id)),
        printingRouteRepository.listForEntities(pool, 'MENU_ITEM_VARIANT', allVariantIds),
        modifierAssignmentRepository.listForEntities(pool, 'MENU_ITEM', uniqueFoodItemIds),
        modifierAssignmentRepository.listForEntities(pool, 'MENU_ITEM_ASSIGNMENT', itemAssignments.map((item) => item.id)),
        modifierAssignmentRepository.listForEntities(pool, 'MENU_ITEM_VARIANT', allVariantIds),
      ]);
    const groupByEntity = <T extends { entity_id: string }>(rows: T[]) => {
      const grouped = new Map<string, T[]>();
      for (const row of rows) grouped.set(row.entity_id, [...(grouped.get(row.entity_id) ?? []), row]);
      return grouped;
    };
    const foodCounters = groupByEntity(foodCounterRoutes);
    const itemCounters = groupByEntity(itemCounterRoutes);
    const variantCounters = groupByEntity(variantCounterRoutes);
    const foodKitchens = groupByEntity(foodPrintingRoutes);
    const itemKitchens = groupByEntity(itemPrintingRoutes);
    const variantKitchens = groupByEntity(variantPrintingRoutes);
    const foodModifiers = groupByEntity(foodModifierAssignments);
    const itemModifiers = groupByEntity(itemModifierAssignments);
    const variantModifiers = groupByEntity(variantModifierAssignments);

    // `findPrimaryForEntities` returns the media asset id, not a path, so reaching the bytes
    // always means building a URL — `mediaUrlFor` decides which kind. A legacy `image_path`
    // with no assignment has no id to build from and renders nothing rather than a broken
    // `<img>`.
    const toUrl = (mediaId: string | undefined): string | null =>
      mediaId ? mediaUrlFor(mediaId) : null;

    // An item can be assigned to a menu without being placed in any category on it — the
    // assignment form does not require one. Dropping such an item from the tree would make it
    // sellable in Menu Master but invisible everywhere the tree is the only read path (the
    // POS), so it surfaces here as an "Uncategorized" bucket rather than disappearing.
    const buildItem = (item: (typeof itemAssignments)[number]): ResolvedMenuItemDto => {
      const inheritedCounters = itemCounters.get(item.id)?.length
        ? itemCounters.get(item.id) ?? []
        : foodCounters.get(item.food_item_id) ?? [];
      const inheritedKitchens = itemKitchens.get(item.id)?.length
        ? itemKitchens.get(item.id) ?? []
        : foodKitchens.get(item.food_item_id) ?? [];
      const inheritedModifiers = itemModifiers.get(item.id)?.length
        ? itemModifiers.get(item.id) ?? []
        : foodModifiers.get(item.food_item_id) ?? [];
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
          preparationTimeMinutes: variant.preparation_time_minutes,
          allowDecimalQuantity: variant.allow_decimal_quantity === 1,
          counters: (variantCounters.get(variant.id)?.length
            ? variantCounters.get(variant.id) ?? []
            : inheritedCounters
          ).map((route) => route.counter_id),
          printingGroups: (variantKitchens.get(variant.id)?.length
            ? variantKitchens.get(variant.id) ?? []
            : inheritedKitchens
          ).map((route) => route.printing_group_id),
          modifierGroupIds: (variantModifiers.get(variant.id)?.length
            ? variantModifiers.get(variant.id) ?? []
            : inheritedModifiers
          ).map((assignment) => assignment.modifier_group_id),
        }),
      );
      return {
        id: item.id,
        foodItemId: item.food_item_id,
        name: item.display_name ?? item.food_item_name ?? '',
        nameHi: item.display_name_hi ?? item.food_item_name_hi ?? null,
        description: item.description ?? item.food_item_description ?? null,
        unit: item.unit ?? item.food_item_unit ?? 'NOS',
        availability: item.availability,
        sortOrder: item.sort_order,
        primaryMediaUrl: toUrl(itemMedia.get(item.id)) ?? toUrl(foodItemMedia.get(item.food_item_id)),
        preparationTimeMinutes: item.preparation_time_minutes,
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
   * other list in it already does: refetching after a mutation.
   *
   * It is, however, exactly the seam a Digital Menu Board needs: every write in this file that
   * reaches here touches something `getMenuTree` resolves, and every board renders that tree.
   * Firing here rather than duplicating a call at each of the ~40 mutation sites above is what
   * keeps a menu-master write and a board refresh from drifting apart as new mutations are
   * added later.
   */
  private announce(entity: string, _syncSeq: number): void {
    menuBoardRealtime.announceChange(`menu-master:${entity}`);
  }
}

export const menuMasterService = new MenuMasterService();
