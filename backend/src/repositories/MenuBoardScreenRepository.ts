import type { MasterStatus, MenuBoardConfig } from '@menuboard/shared';
import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { MenuBoardScreenRow } from '../models/menuBoardRows';
import type { CountRow } from '../models/rows';
import { toJsonColumn } from '../utils/json';
import { toDbDateTime } from '../utils/time';

/**
 * The Digital Menu Board screen registry.
 *
 * Every select joins `menus` on the code for display, the same way `KioskDeviceRepository`
 * does: an operator reading a list of screens needs "Counter Menu Board — Prasad Menu" on one
 * line, and composing that from two requests is how a settings page becomes slow enough to
 * avoid using. The join is on `code`, not `id`, because that is what the column holds — and it
 * is a LEFT JOIN because a blank `menu_code` (fall back to the POS default) is a valid state.
 */

const COLUMNS = `
  s.id, s.code, s.name, s.menu_code, s.poll_seconds, s.config, s.status, s.last_seen_at,
  s.created_by, s.created_at, s.updated_at, s.deleted_at, s.revision,
  m.name AS menu_name`;

const FROM = `
  FROM menu_board_screens s
  LEFT JOIN menus m ON m.code = s.menu_code AND m.deleted_at IS NULL`;

export interface MenuBoardScreenInsert {
  id: string;
  code: string;
  name: string;
  menuCode: string;
  pollSeconds: number;
  config: MenuBoardConfig;
  status: MasterStatus;
  createdBy: string | null;
}

export type MenuBoardScreenUpdate = Partial<Omit<MenuBoardScreenInsert, 'id' | 'createdBy'>>;

export class MenuBoardScreenRepository {
  async findById(db: Db, id: string): Promise<MenuBoardScreenRow | null> {
    return selectOne<MenuBoardScreenRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE s.id = ? AND s.deleted_at IS NULL`,
      [id],
    );
  }

  /**
   * By the code in the screen's URL. Case-insensitive on the collation the column already
   * carries, so `?screen=main` reaches the screen registered as `MAIN`.
   */
  async findByCode(db: Db, code: string): Promise<MenuBoardScreenRow | null> {
    return selectOne<MenuBoardScreenRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE s.code = ? AND s.deleted_at IS NULL`,
      [code],
    );
  }

  /** The screen a bare URL with no `?screen=` resolves to: the first active one by name. */
  async findDefault(db: Db): Promise<MenuBoardScreenRow | null> {
    return selectOne<MenuBoardScreenRow>(
      db,
      `SELECT ${COLUMNS} ${FROM}
        WHERE s.deleted_at IS NULL AND s.status = 'ACTIVE'
        ORDER BY s.name ASC LIMIT 1`,
    );
  }

  async list(db: Db, options: { activeOnly?: boolean } = {}): Promise<MenuBoardScreenRow[]> {
    const where = options.activeOnly === true ? "AND s.status = 'ACTIVE'" : '';
    return selectRows<MenuBoardScreenRow>(
      db,
      `SELECT ${COLUMNS} ${FROM} WHERE s.deleted_at IS NULL ${where} ORDER BY s.name ASC`,
    );
  }

  async countByCode(db: Db, code: string, excludeId: string | null): Promise<number> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM menu_board_screens
        WHERE code = ? AND deleted_at IS NULL AND (? IS NULL OR id <> ?)`,
      [code, excludeId, excludeId],
    );
    return row === null ? 0 : Number(row.total);
  }

  async insert(db: Db, input: MenuBoardScreenInsert): Promise<MenuBoardScreenRow> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO menu_board_screens
        (id, code, name, menu_code, poll_seconds, config, status, created_by,
         created_at, updated_at, revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        input.id,
        input.code,
        input.name,
        input.menuCode,
        input.pollSeconds,
        toJsonColumn(input.config),
        input.status,
        input.createdBy,
        now,
        now,
      ],
    );
    const row = await this.findById(db, input.id);
    if (row === null) throw new Error('Inserted menu board screen could not be read back');
    return row;
  }

  async update(
    db: Db,
    id: string,
    input: MenuBoardScreenUpdate,
  ): Promise<MenuBoardScreenRow | null> {
    const assignments: string[] = [];
    const params: unknown[] = [];

    const set = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (input.code !== undefined) set('code', input.code);
    if (input.name !== undefined) set('name', input.name);
    if (input.menuCode !== undefined) set('menu_code', input.menuCode);
    if (input.pollSeconds !== undefined) set('poll_seconds', input.pollSeconds);
    if (input.config !== undefined) set('config', toJsonColumn(input.config));
    if (input.status !== undefined) set('status', input.status);

    if (assignments.length > 0) {
      await mutate(
        db,
        `UPDATE menu_board_screens
            SET ${assignments.join(', ')}, updated_at = ?, revision = revision + 1
          WHERE id = ? AND deleted_at IS NULL`,
        [...params, toDbDateTime(), id],
      );
    }
    return this.findById(db, id);
  }

  async softDelete(db: Db, id: string): Promise<boolean> {
    const now = toDbDateTime();
    const result = await mutate(
      db,
      `UPDATE menu_board_screens SET deleted_at = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND deleted_at IS NULL`,
      [now, now, id],
    );
    return result.affectedRows > 0;
  }

  /**
   * Stamped when a screen fetches its snapshot, which is the only heartbeat a board has.
   * Written without bumping `revision` — a screen being switched on is not an edit to its
   * configuration, and treating it as one would make every board look freshly changed every
   * poll, and would change the snapshot revision on every request.
   */
  async touch(db: Db, id: string): Promise<void> {
    await mutate(db, 'UPDATE menu_board_screens SET last_seen_at = ? WHERE id = ?', [
      toDbDateTime(),
      id,
    ]);
  }
}

export const menuBoardScreenRepository = new MenuBoardScreenRepository();
