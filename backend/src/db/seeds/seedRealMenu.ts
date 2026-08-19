import { AttachmentKind, AvailabilityStatus, MasterStatus, MediaEntityType, MediaRole, MediaType, RoutableEntityType } from '@menuboard/shared';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  menuCategoryRepository,
  menuItemRepository,
} from '../../repositories/MasterRepository';
import {
  counterRepository,
  counterRouteRepository,
  menuCategoryAssignmentRepository,
  menuItemAssignmentRepository,
  menuRepository,
} from '../../repositories/MenuMasterRepository';
import { mediaAssetRepository, mediaAssignmentRepository } from '../../repositories/MediaRepository';
import { storeUploadedFile } from '../../utils/mediaStorage';
import { newId } from '../../utils/ids';
import { logger } from '../../utils/logger';
import type { Db } from '../types';
import { selectOne, type RowDataPacket } from '../types';

/**
 * The real, currently-printed menu (source: "Menu - Copy.xlsx" — Category, Category_Hindi,
 * Name, Name_Hindi, Price, IsMorning, Image), grouped into the "Main Menu" served from a
 * single default counter. Idempotent, following the same existence-check convention as the
 * rest of `seed.ts`: safe to run repeatedly, changes nothing an administrator has since
 * edited.
 */

interface ExistsRow extends RowDataPacket {
  id: string;
}

const MENU_CODE = 'PMENU';
const MENU_NAME = 'Public Menu';
const COUNTER_CODE = 'C1';
const COUNTER_NAME = 'Counter 1';

const REAL_MENU: readonly {
  category: string;
  categoryHi: string;
  items: readonly { name: string; nameHi: string | null; price: number; imagePath: string | null }[];
}[] = [
    {
      category: 'Sweet',
      categoryHi: 'मीठा',
      items: [
        { name: 'Gulab Jamun', nameHi: 'गुलाब जामुन (देसी घी)', price: 25, imagePath: 'images/gulab-jamun.webp' },
        { name: 'Chocolate Donut', nameHi: 'चॉकलेट डोनट', price: 60, imagePath: 'images/chocolate-donut.webp' },
        { name: 'Cream Roll', nameHi: 'क्रीमरोल', price: 40, imagePath: null },
        { name: 'Pastry or Pudding', nameHi: 'पेस्ट्री या पुडिंग', price: 63, imagePath: 'images/pastry-or-pudding.webp' },
        { name: 'Brownie (Walnut)', nameHi: 'ब्राउनी (वालनट)', price: 60, imagePath: 'images/brownie-walnut.webp' },
        { name: 'Muffin', nameHi: 'मफिन', price: 30, imagePath: 'images/muffin.webp' },
      ],
    },
    {
      category: 'Prasad',
      categoryHi: 'प्रसाद',
      items: [
        { name: 'Peda', nameHi: 'पेड़', price: 500, imagePath: 'images/peda-2.webp' },
        { name: 'Besan Ladoo', nameHi: 'बेसन लड्डू (देसी घी)', price: 500, imagePath: 'images/besan-ladoo.webp' },
        { name: 'Meva Ladoo', nameHi: 'मेवा लड्डू (देसी घी)', price: 800, imagePath: 'images/meva-ladoo.webp' },
      ],
    },
    {
      category: 'Main',
      categoryHi: 'मुख्य',
      items: [
        { name: 'Aaloo Paratha', nameHi: null, price: 80, imagePath: null },
        { name: 'Chowmein', nameHi: 'चाऊमीन', price: 70, imagePath: 'images/chowmein.webp' },
        { name: 'Idli Sambhar', nameHi: 'इडली सांभर', price: 80, imagePath: 'images/idli-sambhar.webp' },
        { name: 'Chole Bhature', nameHi: 'छोले भटूरे', price: 100, imagePath: 'images/chole-bhature.webp' },
        { name: 'Masala Dosa', nameHi: 'डोसा', price: 120, imagePath: 'images/masala-dosa.webp' },
        { name: 'Pizza', nameHi: 'पिज़्ज़ा', price: 250, imagePath: 'images/pizza.webp' },
        { name: 'Paneer Pizza', nameHi: 'पनीर पिज़्ज़ा', price: 350, imagePath: 'images/paneer-pizza.webp' },
        { name: 'French Fries', nameHi: 'फ्रेंच फ्राइज', price: 100, imagePath: 'images/french-fries.webp' },
        { name: 'Burger', nameHi: 'बर्गर', price: 70, imagePath: 'images/burger.webp' },
      ],
    },
    {
      category: 'Counter',
      categoryHi: 'काउन्टर',
      items: [
        { name: 'Patties - Masala', nameHi: 'पेटीज - मसाला', price: 40, imagePath: null },
        { name: 'Chole Kulche', nameHi: 'छोले कुलचे', price: 70, imagePath: 'images/chole-kulche.webp' },
        { name: 'Patties Paneer', nameHi: 'पटीज़ - पनीर', price: 60, imagePath: null },
        { name: 'Sandwich', nameHi: 'सैंडविच (ग्रिल्ड)', price: 70, imagePath: 'images/sandwich.webp' },
        { name: 'Samosa', nameHi: 'समोसा', price: 20, imagePath: 'images/samosa.webp' },
        { name: 'Pav Bhaji', nameHi: 'पाव भाजी', price: 80, imagePath: null },
        { name: 'Samosa Matar', nameHi: 'समोसा मटर', price: 60, imagePath: null },
        { name: 'Paneer Burger', nameHi: 'पनीर बर्गर', price: 120, imagePath: null },
      ],
    },
    {
      category: 'Drink',
      categoryHi: 'पेय',
      items: [
        { name: 'Coffee', nameHi: 'कॉफ़ी', price: 30, imagePath: null },
        { name: 'Cold Coffee', nameHi: 'कोल्ड कॉफ़ी', price: 80, imagePath: 'images/cold-coffee.webp' },
        { name: 'Tea', nameHi: 'चाय', price: 20, imagePath: 'images/tea.webp' },
        { name: 'Water', nameHi: 'जल', price: 20, imagePath: 'images/water.webp' },
        { name: 'Mango Drink', nameHi: 'मैंगो ड्रिंक', price: 20, imagePath: null },
        { name: 'Lassi', nameHi: 'लस्सी', price: 60, imagePath: null },
        { name: 'Lemon Soda', nameHi: 'सोडा', price: 30, imagePath: null },
        { name: 'Orange Drink', nameHi: 'ऑरेंज ड्रिंक', price: 20, imagePath: null },
      ],
    },
    {
      category: 'Chaat',
      categoryHi: 'चाट',
      items: [
        { name: 'Tikki Chaat', nameHi: 'आलू टिक्की चाट', price: 60, imagePath: 'images/tikki-chaat.webp' },
        { name: 'Samosa Chhola', nameHi: 'समोसा छोला', price: 60, imagePath: 'images/samosa-chhola.webp' },
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

export async function seedRealMenu(db: Db, superAdminId: string): Promise<void> {
  let counter = await counterRepository.findById(db, (await findByName(db, 'counters', COUNTER_NAME)) ?? '');
  if (counter === null) {
    counter = await counterRepository.insert(db, {
      id: newId(),
      name: COUNTER_NAME,
      code: COUNTER_CODE,
      description: null,
      status: MasterStatus.ACTIVE,
      sortOrder: 0,
      createdBy: superAdminId,
    });
  }

  let menu = await menuRepository.findByCode(db, MENU_CODE);
  if (menu === null) {
    menu = await menuRepository.insert(db, {
      id: newId(),
      code: MENU_CODE,
      name: MENU_NAME,
      description: null,
      status: MasterStatus.ACTIVE,
      sortOrder: 0,
      priority: 0,
      effectiveFrom: null,
      effectiveUntil: null,
      createdBy: superAdminId,
    });
  }

  const existingMenuImages = await mediaAssignmentRepository.listForEntity(db, MediaEntityType.MENU, menu.id);
  if (existingMenuImages.length === 0) {
    const assetId = newId();
    const assetSource = path.resolve(__dirname, 'assets', 'menu-cover.jpg');
    const tmpPath = path.resolve(__dirname, 'assets', `.tmp-${assetId}.jpg`);
    await fs.copyFile(assetSource, tmpPath);
    try {
      const stored = await storeUploadedFile({
        attachmentId: assetId,
        tempPath: tmpPath,
        mimeType: 'image/jpeg',
        kind: AttachmentKind.IMAGE,
      });
      await mediaAssetRepository.insert(db, {
        id: assetId,
        fileName: 'menu-cover.jpg',
        storagePath: stored.storagePath,
        mimeType: 'image/jpeg',
        fileExtension: '.jpg',
        sizeBytes: stored.sizeBytes,
        width: null,
        height: null,
        mediaType: MediaType.IMAGE,
        title: 'Public Menu Cover',
        altText: 'A restaurant menu displayed on a table',
        checksum: stored.checksum,
        createdBy: superAdminId,
      });
      await mediaAssignmentRepository.insert(db, {
        id: newId(),
        mediaId: assetId,
        entityType: MediaEntityType.MENU,
        entityId: menu.id,
        role: MediaRole.COVER,
        isPrimary: true,
        sortOrder: 0,
        createdBy: superAdminId,
      });
      logger.info('Seeded menu cover image', { menuId: menu.id, assetId });
    } finally {
      await fs.rm(tmpPath, { force: true });
    }
  }

  for (const [categoryIndex, group] of REAL_MENU.entries()) {
    let categoryId = await findByName(db, 'menu_categories', group.category);
    if (categoryId === null) {
      const category = await menuCategoryRepository.insert(db, {
        id: newId(),
        catalogueId: menu.id,
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

    let categoryAssignment = await menuCategoryAssignmentRepository.findByMenuAndCategory(
      db,
      menu.id,
      categoryId,
    );
    if (categoryAssignment === null) {
      categoryAssignment = await menuCategoryAssignmentRepository.insert(db, {
        id: newId(),
        menuId: menu.id,
        categoryId,
        displayName: null,
        displayNameHi: null,
        description: null,
        descriptionHi: null,
        status: MasterStatus.ACTIVE,
        sortOrder: categoryIndex,
        posVisible: true,
        boardVisible: true,
        createdBy: superAdminId,
      });
    }

    for (const [itemIndex, item] of group.items.entries()) {
      const existingItemId = await selectOne<ExistsRow>(
        db,
        'SELECT id FROM menu_items WHERE category_id = ? AND name = ? LIMIT 1',
        [categoryId, item.name],
      );

      const foodItem =
        existingItemId === null
          ? await menuItemRepository.insert(db, {
            id: newId(),
            categoryId,
            name: item.name,
            nameHi: item.nameHi,
            unit: 'NOS',
            unitHi: 'नग',
            imagePath: item.imagePath,
            basePrice: item.price,
            status: MasterStatus.ACTIVE,
            sortOrder: itemIndex,
            createdBy: superAdminId,
          })
          : await menuItemRepository.findById(db, existingItemId.id);
      if (foodItem === null) throw new Error(`Real menu item could not be read back: ${item.name}`);

      const itemAssignment = await menuItemAssignmentRepository.findByMenuAndFoodItem(
        db,
        menu.id,
        foodItem.id,
      );
      if (itemAssignment === null) {
        await menuItemAssignmentRepository.insert(db, {
          id: newId(),
          menuId: menu.id,
          foodItemId: foodItem.id,
          categoryAssignmentId: categoryAssignment.id,
          displayName: null,
          displayNameHi: null,
          description: null,
          descriptionHi: null,
          preparationMethod: null,
          preparationMethodHi: null,
          preparationTimeMinutes: null,
          unit: null,
          status: MasterStatus.ACTIVE,
          availability: AvailabilityStatus.AVAILABLE,
          sortOrder: itemIndex,
          posVisible: true,
          boardVisible: true,
          qrVisible: true,
          webVisible: true,
          appVisible: true,
          dineInAvailable: true,
          takeawayAvailable: true,
          deliveryAvailable: true,
          allowDecimalQuantity: false,
          createdBy: superAdminId,
        });
      }

      const existingRoutes = await counterRouteRepository.listForEntity(
        db,
        RoutableEntityType.MENU_ITEM,
        foodItem.id,
      );
      if (!existingRoutes.some((route) => route.counter_id === counter!.id)) {
        await counterRouteRepository.insert(db, {
          id: newId(),
          entityType: RoutableEntityType.MENU_ITEM,
          entityId: foodItem.id,
          counterId: counter.id,
          status: MasterStatus.ACTIVE,
          createdBy: superAdminId,
        });
      }
    }
  }

  logger.info('Seeded real menu', { menu: MENU_NAME, counter: COUNTER_NAME, categories: REAL_MENU.length });
}
