import {
  MasterStatus,
  type ActivityTypeDto,
  type ActivityTypeWriteRequest,
  type StationDto,
  type CreateStationRequest,
  type MenuCategoryDto,
  type MenuCategoryWriteRequest,
  type MenuItemDto,
  type MenuItemWriteRequest,
  type SyncEntity,
  type UpdateStationRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import {
  mapActivityType,
  mapMenuCategory,
  mapMenuItem,
  mapStation,
} from '../models/mappers';
import {
  activityTypeRepository,
  menuCategoryRepository,
  menuItemRepository,
  stationRepository,
  type MasterListFilter,
} from '../repositories/MasterRepository';
import {
  counterRouteRepository,
  itemGroupRepository,
  menuCategoryAssignmentRepository,
  menuItemAssignmentRepository,
  menuItemScheduleRepository,
  menuItemVariantCatalogPriceRepository,
  menuItemVariantRepository,
  menuRepository,
  modifierAssignmentRepository,
  printingRouteRepository,
} from '../repositories/MenuMasterRepository';
import { mediaAssignmentRepository } from '../repositories/MediaRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import { ConflictError, NotFoundError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import type { Db } from '../db/types';

export interface MasterQuery {
  search?: string;
  status?: MasterStatus;
  /** A menu id narrows to one Menu Catalogue; `null` asks for the unfiled rows. */
  catalogueId?: string | null;
  page?: number;
  pageSize?: number;
}

function pagingFor(query: MasterQuery): MasterListFilter & { page: number; pageSize: number } {
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
 * Master data (stations, activity types, menu categories, menu items).
 *
 * Writes are Admin Portal only — MASTER_WRITE is in ANDROID_FORBIDDEN_CAPABILITIES. Android
 * reads these through sync as a read-only cache and can never originate a change.
 *
 * Deletion is a soft delete, and is refused where the record is still referenced: a menu item
 * that appears on an order must be deactivated rather than deleted, or historical orders
 * would lose their meaning.
 */
export class MasterService {
  /* --------------------------------------------------------------- stations */

  async listStations(query: MasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await stationRepository.list(getPool(), filter);
    return buildPage(rows.map(mapStation), total, filter.page, filter.pageSize);
  }

  async getStationById(id: string): Promise<StationDto> {
    const row = await stationRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Station', id);
    return mapStation(row);
  }

  async createStation(input: CreateStationRequest, actor: AuditActor): Promise<StationDto> {
    const row = await withTransaction(async (connection) => {
      const created = await stationRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        code: input.code ?? null,
        description: input.description ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        createdBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'station',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });

    this.announce('stations', Number(row.sync_seq));
    return mapStation(row);
  }

  async updateStation(
    id: string,
    input: UpdateStationRequest,
    actor: AuditActor,
  ): Promise<StationDto> {
    const row = await withTransaction(async (connection) => {
      const before = await stationRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Station', id);

      const updated = await stationRepository.update(connection, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      if (updated === null) throw new NotFoundError('Station', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'station',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: updated.name, status: updated.status },
      });
      return updated;
    });

    this.announce('stations', Number(row.sync_seq));
    return mapStation(row);
  }

  /** Refused while any board still belongs to this station — deactivate instead. */
  async deleteStation(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await stationRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Station', id);

      const boardCount = await stationRepository.countBoardReferences(connection, id);
      if (boardCount > 0) {
        throw new ConflictError(
          `This station still has ${boardCount} board(s); move or archive them before deleting`,
        );
      }

      await stationRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'station',
        entityId: id,
        before: { name: before.name },
      });
    });
    this.announce('stations', 0);
  }

  /* --------------------------------------------------------- activity types */

  async listActivityTypes(query: MasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await activityTypeRepository.list(getPool(), filter);
    return buildPage(rows.map(mapActivityType), total, filter.page, filter.pageSize);
  }

  async createActivityType(
    input: ActivityTypeWriteRequest,
    actor: AuditActor,
  ): Promise<ActivityTypeDto> {
    const row = await withTransaction(async (connection) => {
      const created = await activityTypeRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        // Only the seeder creates system types; anything added here is user-defined.
        isSystem: false,
        createdBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'activity_type',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });

    this.announce('activity_types', Number(row.sync_seq));
    return mapActivityType(row);
  }

  async updateActivityType(
    id: string,
    input: Partial<ActivityTypeWriteRequest>,
    actor: AuditActor,
  ): Promise<ActivityTypeDto> {
    const row = await withTransaction(async (connection) => {
      const before = await activityTypeRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Activity type', id);

      const updated = await activityTypeRepository.update(connection, id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (updated === null) throw new NotFoundError('Activity type', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'activity_type',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: updated.name, status: updated.status },
      });
      return updated;
    });

    this.announce('activity_types', Number(row.sync_seq));
    return mapActivityType(row);
  }

  async deleteActivityType(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await activityTypeRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Activity type', id);

      // Seeded types are part of the product vocabulary; they may be deactivated, not removed.
      if (before.is_system === 1) {
        throw new ConflictError(
          'System activity types cannot be deleted; set the status to INACTIVE instead',
        );
      }

      await activityTypeRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'activity_type',
        entityId: id,
        before: { name: before.name },
      });
    });
    this.announce('activity_types', 0);
  }

  /* -------------------------------------------------------- menu categories */

  /**
   * Keeps `menu_category_assignments` in step with the category's `catalogue_id`.
   *
   * `catalogue_id` is the fact the operator states; the assignment row is the derived record
   * the kiosk, the menu tree, POS and `menu_item_assignments.category_assignment_id` all still
   * read. Writing only the column would silently leave those consumers showing the old menu.
   *
   * Moving a category that already has items filed under it on the old menu is refused rather
   * than performed: those `menu_item_assignments` rows point at the assignment being retired,
   * and dragging them to a different menu behind the operator's back is not a decision this
   * function is entitled to make.
   */
  private async syncCategoryAssignment(
    db: Db,
    categoryId: string,
    catalogueId: string | null,
    actor: AuditActor,
  ): Promise<void> {
    if (catalogueId !== null) {
      const menu = await menuRepository.findById(db, catalogueId);
      if (menu === null) throw new NotFoundError('Menu catalogue', catalogueId);
    }

    const existing = await menuCategoryAssignmentRepository.listForCategory(db, categoryId);

    for (const assignment of existing) {
      if (assignment.menu_id === catalogueId) continue;
      const itemCount = await menuCategoryAssignmentRepository.countItemReferences(
        db,
        assignment.id,
      );
      if (itemCount > 0) {
        throw new ConflictError(
          `This category still has ${itemCount} item(s) on its current catalogue; move or remove them before changing the catalogue`,
        );
      }
      await menuCategoryAssignmentRepository.softDelete(db, assignment.id);
    }

    if (catalogueId === null) return;
    if (existing.some((assignment) => assignment.menu_id === catalogueId)) return;

    await menuCategoryAssignmentRepository.insert(db, {
      id: newId(),
      menuId: catalogueId,
      categoryId,
      // Every override stays null: with one catalogue per category there is nothing to override,
      // and the assignment falls back to the category's own name, description and visibility.
      displayName: null,
      displayNameHi: null,
      description: null,
      descriptionHi: null,
      status: MasterStatus.ACTIVE,
      sortOrder: 0,
      posVisible: true,
      boardVisible: true,
      createdBy: actor.userId,
    });
  }

  async listMenuCategories(query: MasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await menuCategoryRepository.list(getPool(), filter);
    return buildPage(rows.map(mapMenuCategory), total, filter.page, filter.pageSize);
  }

  async createMenuCategory(
    input: MenuCategoryWriteRequest,
    actor: AuditActor,
  ): Promise<MenuCategoryDto> {
    const row = await withTransaction(async (connection) => {
      const catalogueId = input.catalogueId ?? null;
      const created = await menuCategoryRepository.insert(connection, {
        id: input.id ?? newId(),
        catalogueId,
        name: input.name,
        nameHi: input.nameHi ?? null,
        description: input.description ?? null,
        imagePath: input.imagePath ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });

      await this.syncCategoryAssignment(connection, created.id, catalogueId, actor);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_category',
        entityId: created.id,
        after: { name: created.name, catalogueId },
      });
      return created;
    });

    this.announce('menu_categories', Number(row.sync_seq));
    return mapMenuCategory(row);
  }

  async updateMenuCategory(
    id: string,
    input: Partial<MenuCategoryWriteRequest>,
    actor: AuditActor,
  ): Promise<MenuCategoryDto> {
    const row = await withTransaction(async (connection) => {
      const before = await menuCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu category', id);

      const updated = await menuCategoryRepository.update(connection, id, {
        ...(input.catalogueId !== undefined ? { catalogueId: input.catalogueId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (updated === null) throw new NotFoundError('Menu category', id);

      if (input.catalogueId !== undefined && input.catalogueId !== before.catalogue_id) {
        await this.syncCategoryAssignment(connection, id, input.catalogueId, actor);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_category',
        entityId: id,
        before: { name: before.name, status: before.status, catalogueId: before.catalogue_id },
        after: { name: updated.name, status: updated.status, catalogueId: updated.catalogue_id },
      });
      return updated;
    });

    this.announce('menu_categories', Number(row.sync_seq));
    return mapMenuCategory(row);
  }

  async deleteMenuCategory(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await menuCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu category', id);

      const itemCount = await menuCategoryRepository.countActiveItems(connection, id);
      if (itemCount > 0) {
        throw new ConflictError(
          `This category still contains ${itemCount} item(s); move or delete them first`,
        );
      }

      // The derived assignment row goes with it, or the catalogue would keep listing a category
      // that no longer exists. countActiveItems above already guaranteed nothing is filed here.
      await this.syncCategoryAssignment(connection, id, null, actor);
      await menuCategoryRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_category',
        entityId: id,
        before: { name: before.name },
      });
    });
    this.announce('menu_categories', 0);
  }

  /* ------------------------------------------------------------- menu items */

  async listMenuItems(query: MasterQuery & { categoryId?: string; groupId?: string }, userId?: string) {
    const filter = pagingFor(query);
    const { rows, total } = await menuItemRepository.list(getPool(), {
      ...filter,
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.groupId !== undefined ? { groupId: query.groupId } : {}),
    });
    return buildPage(
      rows.map((row) => mapMenuItem(row, userId)),
      total,
      filter.page,
      filter.pageSize,
    );
  }

  async getMenuItemById(id: string, userId?: string): Promise<MenuItemDto> {
    const row = await menuItemRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Menu item', id);
    return mapMenuItem(row, userId);
  }

  async createMenuItem(input: MenuItemWriteRequest, actor: AuditActor): Promise<MenuItemDto> {
    const row = await withTransaction(async (connection) => {
      const category = await menuCategoryRepository.findById(connection, input.categoryId);
      if (category === null) throw new NotFoundError('Menu category', input.categoryId);

      const created = await menuItemRepository.insert(connection, {
        id: input.id ?? newId(),
        categoryId: input.categoryId,
        groupId: input.groupId ?? null,
        name: input.name,
        nameHi: input.nameHi ?? null,
        description: input.description ?? null,
        descriptionHi: input.descriptionHi ?? null,
        unit: input.unit,
        unitHi: input.unitHi ?? null,
        imagePath: input.imagePath ?? null,
        basePrice: input.basePrice ?? null,
        taxProfileId: input.taxProfileId ?? null,
        alwaysAvailable: input.alwaysAvailable ?? true,
        prepSeconds: input.prepSeconds ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'menu_item',
        entityId: created.id,
        after: { name: created.name, categoryId: created.category_id, unit: created.unit },
      });
      return created;
    });

    this.announce('menu_items', Number(row.sync_seq));
    return mapMenuItem(row, actor.userId ?? undefined);
  }

  async updateMenuItem(
    id: string,
    input: Partial<MenuItemWriteRequest>,
    actor: AuditActor,
  ): Promise<MenuItemDto> {
    const row = await withTransaction(async (connection) => {
      const before = await menuItemRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item', id);

      if (input.categoryId !== undefined) {
        const category = await menuCategoryRepository.findById(connection, input.categoryId);
        if (category === null) throw new NotFoundError('Menu category', input.categoryId);
      }
      if (input.groupId !== undefined && input.groupId !== null) {
        const group = await itemGroupRepository.findById(connection, input.groupId);
        if (group === null) throw new NotFoundError('Item group', input.groupId);
      }

      const updated = await menuItemRepository.update(connection, id, {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.descriptionHi !== undefined ? { descriptionHi: input.descriptionHi } : {}),
        ...(input.unit !== undefined ? { unit: input.unit } : {}),
        ...(input.unitHi !== undefined ? { unitHi: input.unitHi } : {}),
        ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
        ...(input.basePrice !== undefined ? { basePrice: input.basePrice } : {}),
        ...(input.taxProfileId !== undefined ? { taxProfileId: input.taxProfileId } : {}),
        ...(input.alwaysAvailable !== undefined
          ? { alwaysAvailable: input.alwaysAvailable }
          : {}),
        ...(input.prepSeconds !== undefined ? { prepSeconds: input.prepSeconds } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (updated === null) throw new NotFoundError('Menu item', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'menu_item',
        entityId: id,
        before: { name: before.name, unit: before.unit, status: before.status },
        after: { name: updated.name, unit: updated.unit, status: updated.status },
      });
      return updated;
    });

    this.announce('menu_items', Number(row.sync_seq));
    return mapMenuItem(row, actor.userId ?? undefined);
  }

  async deleteMenuItem(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await menuItemRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Menu item', id);

      const references = await menuItemRepository.countOrderReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `This item appears on ${references} order(s); set its status to INACTIVE instead of deleting it`,
        );
      }

      const assignments = await menuItemAssignmentRepository.listForFoodItem(connection, id, true);
      const variants = await menuItemVariantRepository.listForFoodItem(connection, id, true);
      const targets: { type: 'MENU_ITEM' | 'MENU_ITEM_ASSIGNMENT' | 'MENU_ITEM_VARIANT'; id: string }[] = [
        { type: 'MENU_ITEM', id },
        ...assignments.map((assignment) => ({ type: 'MENU_ITEM_ASSIGNMENT' as const, id: assignment.id })),
        ...variants.map((variant) => ({ type: 'MENU_ITEM_VARIANT' as const, id: variant.id })),
      ];
      for (const target of targets) {
        await counterRouteRepository.softDeleteForEntity(connection, target.type, target.id);
        await printingRouteRepository.softDeleteForEntity(connection, target.type, target.id);
        await modifierAssignmentRepository.softDeleteForEntity(connection, target.type, target.id);
        await mediaAssignmentRepository.softDeleteForEntity(connection, target.type, target.id);
      }
      await menuItemScheduleRepository.deleteForFoodItem(connection, id);
      await menuItemVariantCatalogPriceRepository.softDeleteForVariants(
        connection,
        variants.map((variant) => variant.id),
      );
      await menuItemAssignmentRepository.softDeleteForFoodItem(connection, id);
      await menuItemVariantRepository.softDeleteForFoodItem(connection, id);
      await menuItemRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'menu_item',
        entityId: id,
        before: { name: before.name },
      });
    });
    this.announce('menu_items', 0);
    menuBoardRealtime.announceChange('menu-master:menu_items');
  }

  /**
   * Master data is global, so the hint goes to the shared `masters` room rather than to a
   * board. Devices then pull the delta as usual.
   */
  private announce(entity: SyncEntity, cursor: number): void {
    realtime.emitMasterChange(entity, cursor);
  }
}

export const masterService = new MasterService();
