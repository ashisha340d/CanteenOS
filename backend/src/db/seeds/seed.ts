import { UserRole, UserStatus } from '@menuboard/shared';
import { getPool } from '../pool';
import { withTransaction } from '../transaction';
import type { Db } from '../types';
import { selectOne } from '../types';
import type { RowDataPacket } from '../types';
import { userRepository } from '../../repositories/UserRepository';
import { newId } from '../../utils/ids';
import { hashPassword } from '../../utils/password';
import { logger } from '../../utils/logger';
import { allocateSyncSeq } from '../syncSeq';
import { mutate } from '../types';
import { toDbDateTime } from '../../utils/time';
import { seedRealMenu } from './seedRealMenu';

/**
 * Idempotent seed. Safe to run repeatedly: every insert is guarded by an existence check, so a
 * second run adds nothing and changes nothing an administrator has since edited.
 */

interface ExistsRow extends RowDataPacket {
  id: string;
}

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'MenuBoard@2026';

/** Activity types named in the specification. Marked is_system so they cannot be deleted. */
const ACTIVITY_TYPES = [
  { name: 'Breakfast', icon: 'sunrise' },
  { name: 'Lunch', icon: 'sun' },
  { name: 'Dinner', icon: 'moon' },
  { name: 'Festival', icon: 'sparkles' },
  { name: 'Special Event', icon: 'star' },
  { name: 'Cleaning', icon: 'broom' },
  { name: 'Meeting', icon: 'users' },
  { name: 'Transport', icon: 'truck' },
] as const;

/**
 * Stations and boards are administrator-created through the Admin Portal, not seeded — an
 * empty hierarchy avoids demo data an administrator would otherwise have to clean up.
 */

const ASHISH_PIYA = {
  username: 'ashishpiya',
  name: 'Ashish Piya',
  role: UserRole.USER,
} as const;

async function findByName(db: Db, table: string, name: string): Promise<string | null> {
  // Table names come only from this file's literals, never from input.
  const row = await selectOne<ExistsRow>(
    db,
    `SELECT id FROM ${table} WHERE name = ? AND deleted_at IS NULL LIMIT 1`,
    [name],
  );
  return row === null ? null : row.id;
}

export async function seed(): Promise<void> {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  await withTransaction(async (connection) => {
    /* ------------------------------------------------------------- users */

    const users: { username: string; name: string; role: UserRole }[] = [
      { username: 'superadmin', name: 'Super Administrator', role: UserRole.SUPER_ADMIN },
      { username: 'admin', name: 'Administrator', role: UserRole.ADMIN },
      { username: 'manager', name: 'Operations Manager', role: UserRole.MANAGER },
      { username: 'user1', name: 'Kitchen Coordinator', role: UserRole.USER },
      { username: 'user2', name: 'Dining Coordinator', role: UserRole.USER },
      { username: ASHISH_PIYA.username, name: ASHISH_PIYA.name, role: ASHISH_PIYA.role },
    ];

    const userIds = new Map<string, string>();
    let superAdminId = '';

    for (const definition of users) {
      const existing = await userRepository.findByUsername(connection, definition.username);
      if (existing !== null) {
        userIds.set(definition.username, existing.id);
        if (definition.role === UserRole.SUPER_ADMIN) superAdminId = existing.id;
        continue;
      }

      const row = await userRepository.insert(connection, {
        id: newId(),
        employeeCode: null,
        name: definition.name,
        username: definition.username,
        phone: null,
        email: null,
        passwordHash,
        role: definition.role,
        status: UserStatus.ACTIVE,
        // Seeded credentials are shared and must be replaced on first sign-in.
        mustChangePassword: true,
        createdBy: superAdminId === '' ? null : superAdminId,
      });

      userIds.set(definition.username, row.id);
      if (definition.role === UserRole.SUPER_ADMIN) superAdminId = row.id;
      logger.info('Seeded user', { username: definition.username, role: definition.role });
    }

    if (superAdminId === '') {
      throw new Error('Seed failed: no Super Admin could be resolved');
    }

    /* --------------------------------------------------- activity types */

    for (const [index, activity] of ACTIVITY_TYPES.entries()) {
      if ((await findByName(connection, 'activity_types', activity.name)) !== null) continue;

      // Inserted directly rather than through the repository so `is_system` can be set; the
      // repository deliberately refuses to create system rows.
      const syncSeq = await allocateSyncSeq(connection);
      const now = toDbDateTime();
      await mutate(
        connection,
        `INSERT INTO activity_types
          (id, name, description, icon, status, sort_order, is_system, created_by,
           created_at, updated_at, revision, sync_seq)
         VALUES (?, ?, NULL, ?, 'ACTIVE', ?, 1, ?, ?, ?, 1, ?)`,
        [newId(), activity.name, activity.icon, index, superAdminId, now, now, syncSeq],
      );
    }

    /* -------------------------------------------------------------- menu */

    // Real menu (Public Menu / Counter 1), ported from the printed menu card — see
    // seedRealMenu.ts. No demo/placeholder categories or items are seeded.
    await seedRealMenu(connection, superAdminId);
  });

  const pool = getPool();
  const counts = await selectOne<RowDataPacket & Record<string, number>>(
    pool,
    `SELECT
       (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL)               AS users,
       (SELECT COUNT(*) FROM stations WHERE deleted_at IS NULL)            AS stations,
       (SELECT COUNT(*) FROM boards WHERE deleted_at IS NULL)              AS boards,
       (SELECT COUNT(*) FROM activity_types WHERE deleted_at IS NULL)      AS activity_types,
       (SELECT COUNT(*) FROM menu_categories WHERE deleted_at IS NULL)     AS menu_categories,
       (SELECT COUNT(*) FROM menu_items WHERE deleted_at IS NULL)          AS menu_items,
       (SELECT COUNT(*) FROM ingredient_categories WHERE deleted_at IS NULL) AS ingredient_categories,
       (SELECT COUNT(*) FROM ingredients WHERE deleted_at IS NULL)         AS ingredients,
       (SELECT COUNT(*) FROM recipes WHERE deleted_at IS NULL)             AS recipes,
       (SELECT COUNT(*) FROM recipe_steps WHERE deleted_at IS NULL)        AS recipe_steps,
       (SELECT COUNT(*) FROM orders WHERE deleted_at IS NULL)              AS orders,
       (SELECT COUNT(*) FROM thread_messages WHERE deleted_at IS NULL)     AS thread_messages`,
  );

  logger.info('Seed complete', counts ?? {});
}
