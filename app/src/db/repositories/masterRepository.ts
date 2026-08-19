import type {
  ActivityTypeDto,
  MasterStatus,
  MenuCategoryDto,
  MenuItemDto,
  StationDto,
} from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import { getDb } from '../client';
import type {
  ActivityTypeRow,
  MenuCategoryRow,
  MenuItemRow,
  StationRow,
} from '../models';

/**
 * Read-only local cache of master data (stations, activity types, menu categories, menu
 * items). This module intentionally exposes no create/update/delete — the Android app never
 * originates a write to master data (docs/SCOPE.md, ARCHITECTURE.md §3).
 */

function toStation(row: StationRow): StationDto {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    status: row.status as MasterStatus,
    createdBy: null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function toActivityType(row: ActivityTypeRow): ActivityTypeDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    status: row.status as MasterStatus,
    sortOrder: row.sort_order,
    isSystem: row.is_system === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function toMenuCategory(row: MenuCategoryRow): MenuCategoryDto {
  return {
    id: row.id,
    catalogueId: row.catalogue_id,
    name: row.name,
    nameHi: row.name_hi,
    description: row.description,
    imagePath: row.image_path,
    status: row.status as MasterStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function toMenuItem(row: MenuItemRow): MenuItemDto {
  return {
    id: row.id,
    categoryId: row.category_id,
    groupId: row.group_id,
    nameHi: row.name_hi,
    unitHi: row.unit_hi,
    name: row.name,
    unit: row.unit,
    imagePath: row.image_path,
    primaryMediaId: row.primary_media_id,
    basePrice: row.base_price,
    // Tax is an Admin Portal concern (billing is generated server-side), so the device neither
    // syncs nor mirrors tax profiles — the column does not exist in the local schema.
    taxProfileId: null,
    alwaysAvailable: row.always_available === 1,
    status: row.status as MasterStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    syncSeq: row.server_sync_seq,
    revision: row.revision,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const masterRepository = {
  async replaceStations(rows: StationDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const s of rows) {
        await db.runAsync(
          `INSERT INTO stations (id, name, code, description, status,
             created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, code = excluded.code, description = excluded.description,
             status = excluded.status, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq`,
          [
            s.id, s.name, s.code, s.description, s.status, s.createdAt,
            s.updatedAt, s.deletedAt, s.revision, s.syncSeq,
          ],
        );
      }
    });
  },

  async listActiveStations(): Promise<StationDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<StationRow>(
      `SELECT * FROM stations WHERE deleted_at IS NULL AND status = 'ACTIVE' ORDER BY name ASC`,
    );
    return rows.map(toStation);
  },

  async replaceActivityTypes(rows: ActivityTypeDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const a of rows) {
        await db.runAsync(
          `INSERT INTO activity_types (id, name, description, icon, status, sort_order,
             is_system, created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, description = excluded.description, icon = excluded.icon,
             status = excluded.status, sort_order = excluded.sort_order,
             is_system = excluded.is_system, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq`,
          [
            a.id, a.name, a.description, a.icon, a.status, a.sortOrder, a.isSystem ? 1 : 0,
            a.createdAt, a.updatedAt, a.deletedAt, a.revision, a.syncSeq,
          ],
        );
      }
    });
  },

  async replaceMenuCategories(rows: MenuCategoryDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const c of rows) {
        await db.runAsync(
          `INSERT INTO menu_categories (id, catalogue_id, name, name_hi, description, image_path,
             status, sort_order, created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             catalogue_id = excluded.catalogue_id,
             name = excluded.name, name_hi = excluded.name_hi, description = excluded.description,
             image_path = excluded.image_path, status = excluded.status,
             sort_order = excluded.sort_order, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq`,
          [
            c.id, c.catalogueId, c.name, c.nameHi, c.description, c.imagePath, c.status,
            c.sortOrder, c.createdAt, c.updatedAt, c.deletedAt, c.revision, c.syncSeq,
          ],
        );
      }
    });
  },

  async replaceMenuItems(rows: MenuItemDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const i of rows) {
        await db.runAsync(
          `INSERT INTO menu_items (id, category_id, group_id, name, name_hi, unit, unit_hi, image_path,
             primary_media_id, base_price, always_available, status,
             sort_order, created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             category_id = excluded.category_id, group_id = excluded.group_id, name = excluded.name,
             name_hi = excluded.name_hi, unit = excluded.unit, unit_hi = excluded.unit_hi,
             image_path = excluded.image_path,
             primary_media_id = excluded.primary_media_id, base_price = excluded.base_price,
             always_available = excluded.always_available, status = excluded.status,
             sort_order = excluded.sort_order, updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at, revision = excluded.revision,
             server_sync_seq = excluded.server_sync_seq`,
          [
            i.id, i.categoryId, i.groupId ?? null, i.name, i.nameHi, i.unit, i.unitHi, i.imagePath,
            i.primaryMediaId ?? null, i.basePrice ?? null, i.alwaysAvailable ? 1 : 0,
            i.status, i.sortOrder,
            i.createdAt, i.updatedAt, i.deletedAt, i.revision, i.syncSeq,
          ],
        );
      }
    });
  },

  async listActiveActivityTypes(): Promise<ActivityTypeDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<ActivityTypeRow>(
      `SELECT * FROM activity_types WHERE deleted_at IS NULL AND status = 'ACTIVE'
       ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map(toActivityType);
  },

  async listActiveMenuCategories(): Promise<MenuCategoryDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<MenuCategoryRow>(
      `SELECT * FROM menu_categories WHERE deleted_at IS NULL AND status = 'ACTIVE'
       ORDER BY sort_order ASC, name ASC`,
    );
    return rows.map(toMenuCategory);
  },

  async listActiveMenuItems(categoryId?: string): Promise<MenuItemDto[]> {
    const db = await getDb();
    const rows = categoryId
      ? await db.getAllAsync<MenuItemRow>(
        `SELECT * FROM menu_items WHERE deleted_at IS NULL AND status = 'ACTIVE'
           AND category_id = ? ORDER BY sort_order ASC, name ASC`,
        [categoryId],
      )
      : await db.getAllAsync<MenuItemRow>(
        `SELECT * FROM menu_items WHERE deleted_at IS NULL AND status = 'ACTIVE'
           ORDER BY sort_order ASC, name ASC`,
      );
    return rows.map(toMenuItem);
  },

  async findMenuItemById(id: string): Promise<MenuItemDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<MenuItemRow>('SELECT * FROM menu_items WHERE id = ?', [id]);
    return row ? toMenuItem(row) : null;
  },

  /**
   * Menu items keyed by id, for rendering order lines. Deliberately ignores `status`: an
   * order placed last month may reference an item since retired, and the line still has to
   * show its name rather than a bare id.
   */
  async mapMenuItemsByIds(ids: readonly string[]): Promise<Map<string, MenuItemDto>> {
    const map = new Map<string, MenuItemDto>();
    if (ids.length === 0) return map;
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.getAllAsync<MenuItemRow>(
      `SELECT * FROM menu_items WHERE id IN (${placeholders})`,
      [...ids],
    );
    for (const row of rows) map.set(row.id, toMenuItem(row));
    return map;
  },

  async searchMenuItems(query: string): Promise<MenuItemDto[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<MenuItemRow>(
      `SELECT * FROM menu_items WHERE deleted_at IS NULL AND status = 'ACTIVE'
       AND name LIKE ? ORDER BY name ASC LIMIT 50`,
      [`%${query}%`],
    );
    return rows.map(toMenuItem);
  },
};
