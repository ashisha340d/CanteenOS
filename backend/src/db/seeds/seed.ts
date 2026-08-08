import { MasterStatus, UserRole, UserStatus } from '@menuboard/shared';
import { getPool } from '../pool';
import { withTransaction } from '../transaction';
import type { Db } from '../types';
import { selectOne } from '../types';
import type { RowDataPacket } from '../types';
import {
  activityTypeRepository,
  menuCategoryRepository,
  menuItemRepository,
} from '../../repositories/MasterRepository';
import { userRepository } from '../../repositories/UserRepository';
import { newId } from '../../utils/ids';
import { hashPassword } from '../../utils/password';
import { logger } from '../../utils/logger';
import { allocateSyncSeq } from '../syncSeq';
import { mutate } from '../types';
import { toDbDateTime } from '../../utils/time';
import { seedImportedRecipes } from './seedRecipes';

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

/**
 * Seed catalogue, with the Devanagari spelling authored alongside the English one.
 *
 * These are the names the kitchen already uses; they are stored rather than translated at
 * runtime so the Hindi board reads the same way every time and matches what is written on
 * the counter. Units carry their own Hindi form because they are spoken aloud on the floor.
 */
const MENU: readonly {
  category: string;
  categoryHi: string;
  items: readonly { name: string; nameHi: string; unit: string; unitHi: string }[];
}[] = [
    {
      category: 'Rice & Grains',
      categoryHi: 'चावल एवं अनाज',
      items: [
        { name: 'Steamed Rice', nameHi: 'सादा चावल', unit: 'KG', unitHi: 'किलो' },
        { name: 'Jeera Rice', nameHi: 'जीरा चावल', unit: 'KG', unitHi: 'किलो' },
        { name: 'Pulao', nameHi: 'पुलाव', unit: 'KG', unitHi: 'किलो' },
        { name: 'Khichdi', nameHi: 'खिचड़ी', unit: 'KG', unitHi: 'किलो' },
      ],
    },
    {
      category: 'Breads',
      categoryHi: 'रोटी एवं ब्रेड',
      items: [
        { name: 'Roti', nameHi: 'रोटी', unit: 'NOS', unitHi: 'नग' },
        { name: 'Puri', nameHi: 'पूरी', unit: 'NOS', unitHi: 'नग' },
        { name: 'Paratha', nameHi: 'पराठा', unit: 'NOS', unitHi: 'नग' },
        { name: 'Bhatura', nameHi: 'भटूरा', unit: 'NOS', unitHi: 'नग' },
      ],
    },
    {
      category: 'Dals & Curries',
      categoryHi: 'दाल एवं सब्ज़ी रस',
      items: [
        { name: 'Dal Tadka', nameHi: 'दाल तड़का', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Dal Fry', nameHi: 'दाल फ्राई', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Kadhi', nameHi: 'कढ़ी', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Chole', nameHi: 'छोले', unit: 'KG', unitHi: 'किलो' },
      ],
    },
    {
      category: 'Vegetables',
      categoryHi: 'सब्ज़ियाँ',
      items: [
        { name: 'Mixed Vegetable', nameHi: 'मिक्स वेज', unit: 'KG', unitHi: 'किलो' },
        { name: 'Aloo Gobi', nameHi: 'आलू गोभी', unit: 'KG', unitHi: 'किलो' },
        { name: 'Paneer Butter Masala', nameHi: 'पनीर बटर मसाला', unit: 'KG', unitHi: 'किलो' },
        { name: 'Bhindi Masala', nameHi: 'भिंडी मसाला', unit: 'KG', unitHi: 'किलो' },
      ],
    },
    {
      category: 'Sweets',
      categoryHi: 'मिठाई',
      items: [
        { name: 'Halwa', nameHi: 'हलवा', unit: 'KG', unitHi: 'किलो' },
        { name: 'Kheer', nameHi: 'खीर', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Laddu', nameHi: 'लड्डू', unit: 'NOS', unitHi: 'नग' },
        { name: 'Jalebi', nameHi: 'जलेबी', unit: 'KG', unitHi: 'किलो' },
      ],
    },
    {
      category: 'Beverages',
      categoryHi: 'पेय पदार्थ',
      items: [
        { name: 'Tea', nameHi: 'चाय', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Coffee', nameHi: 'कॉफ़ी', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Buttermilk', nameHi: 'छाछ', unit: 'LTR', unitHi: 'लीटर' },
        { name: 'Drinking Water', nameHi: 'पीने का पानी', unit: 'LTR', unitHi: 'लीटर' },
      ],
    },
    {
      category: 'Accompaniments',
      categoryHi: 'साथ में',
      items: [
        { name: 'Papad', nameHi: 'पापड़', unit: 'NOS', unitHi: 'नग' },
        { name: 'Pickle', nameHi: 'अचार', unit: 'KG', unitHi: 'किलो' },
        { name: 'Salad', nameHi: 'सलाद', unit: 'KG', unitHi: 'किलो' },
        { name: 'Raita', nameHi: 'रायता', unit: 'LTR', unitHi: 'लीटर' },
      ],
    },
  ];

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

    for (const [categoryIndex, group] of MENU.entries()) {
      let categoryId = await findByName(connection, 'menu_categories', group.category);

      if (categoryId === null) {
        const category = await menuCategoryRepository.insert(connection, {
          id: newId(),
          name: group.category,
          nameHi: group.categoryHi,
          description: null,
          imagePath: null,
          status: MasterStatus.ACTIVE,
          sortOrder: categoryIndex,
          createdBy: superAdminId,
        });
        categoryId = category.id;
      }

      for (const [itemIndex, item] of group.items.entries()) {
        const existing = await selectOne<ExistsRow>(
          connection,
          'SELECT id FROM menu_items WHERE category_id = ? AND name = ? LIMIT 1',
          [categoryId, item.name],
        );
        if (existing !== null) continue;

        await menuItemRepository.insert(connection, {
          id: newId(),
          categoryId,
          name: item.name,
          nameHi: item.nameHi,
          unit: item.unit,
          unitHi: item.unitHi,
          imagePath: null,
          status: MasterStatus.ACTIVE,
          sortOrder: itemIndex,
          createdBy: superAdminId,
        });
      }
    }

    /* -------------------------------------------- ingredients & recipes (ported data) */

    // Real dish/ingredient/recipe catalogue ported from the sibling "ashram_kitchen"
    // system, additive alongside the curated MENU above — see seedRecipes.ts.
    await seedImportedRecipes(connection, superAdminId);
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
