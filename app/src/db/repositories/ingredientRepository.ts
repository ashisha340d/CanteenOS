import type * as SQLite from 'expo-sqlite';
import type { IngredientDto, MasterStatus } from '@menuboard/shared';
import { getDb } from '../client';
import type { IngredientRow } from '../models';

/**
 * Recipe-only ingredient master, cached read-only. The Android app never originates a write
 * here — see `app/AGENTS.md`'s "What must never appear in app/" and
 * `docs/MENUBOARD_SPEC.md`'s Android exclusions.
 */

function toIngredient(row: IngredientRow): IngredientDto {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    nameHi: row.name_hi,
    unit: row.unit,
    status: row.status as MasterStatus,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    revision: row.revision,
    syncSeq: row.server_sync_seq,
  };
}

function runInTx(
  db: SQLite.SQLiteDatabase,
  tx: SQLite.SQLiteDatabase | undefined,
  work: () => Promise<void>,
): Promise<void> {
  return tx ? work() : db.withTransactionAsync(work);
}

export const ingredientRepository = {
  async upsertMany(rows: IngredientDto[], tx?: SQLite.SQLiteDatabase): Promise<void> {
    if (rows.length === 0) return;
    const db = tx ?? (await getDb());
    await runInTx(db, tx, async () => {
      for (const ingredient of rows) {
        await db.runAsync(
          `INSERT INTO ingredients (id, category_id, name, name_hi, unit, status, sort_order,
             created_at, updated_at, deleted_at, revision, server_sync_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             category_id = excluded.category_id, name = excluded.name, name_hi = excluded.name_hi,
             unit = excluded.unit, status = excluded.status, sort_order = excluded.sort_order,
             updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
             revision = excluded.revision, server_sync_seq = excluded.server_sync_seq`,
          [
            ingredient.id, ingredient.categoryId, ingredient.name, ingredient.nameHi,
            ingredient.unit, ingredient.status, ingredient.sortOrder, ingredient.createdAt,
            ingredient.updatedAt, ingredient.deletedAt, ingredient.revision, ingredient.syncSeq,
          ],
        );
      }
    });
  },

  async findById(id: string): Promise<IngredientDto | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<IngredientRow>(
      `SELECT * FROM ingredients WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    return row ? toIngredient(row) : null;
  },

  /** Looked up by id for joining names/units onto recipe ingredient rows. */
  async findByIds(ids: string[]): Promise<Map<string, IngredientDto>> {
    const map = new Map<string, IngredientDto>();
    if (ids.length === 0) return map;
    const db = await getDb();
    const unique = Array.from(new Set(ids));
    const placeholders = unique.map(() => '?').join(', ');
    const rows = await db.getAllAsync<IngredientRow>(
      `SELECT * FROM ingredients WHERE id IN (${placeholders})`,
      unique,
    );
    for (const row of rows) {
      map.set(row.id, toIngredient(row));
    }
    return map;
  },
};
