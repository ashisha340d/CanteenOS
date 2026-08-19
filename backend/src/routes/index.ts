import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { apiRateLimit } from '../middleware/rateLimit';
import { authRoutes } from './auth.routes';
import { userRoutes } from './user.routes';
import { boardRoutes } from './board.routes';
import { masterRoutes } from './master.routes';
import { menuMasterRoutes } from './menuMaster.routes';
import { mediaRoutes, publicMediaRoutes } from './media.routes';
import { menuBoardRoutes, publicMenuBoardRoutes } from './menuBoard.routes';
import { orderRoutes } from './order.routes';
import { entityRoutes } from './entity.routes';
import { equipmentRoutes } from './equipment.routes';
import { maintenanceRoutes } from './maintenance.routes';
import { posRoutes } from './pos.routes';
import { kdsRoutes } from './kds.routes';
import { attachmentRoutes, publicAttachmentRoutes } from './attachment.routes';
import { notificationRoutes } from './notification.routes';
import { syncRoutes } from './sync.routes';
import { adminRoutes } from './admin.routes';
import { alertRoutes, recipeRoutes } from './recipe.routes';
import { ingredientCategoryRoutes, ingredientRoutes } from './ingredient.routes';
import { shoppingListRoutes } from './shopping.routes';
import { taskRoutes } from './task.routes';
import { taxRoutes } from './tax.routes';
import { publicVoiceModelRoutes, voiceModelRoutes } from './voiceModel.routes';
import { youtubeImportRoutes } from './youtubeImport.routes';

/**
 * API v1 routing table.
 *
 * `/auth` mounts before `authenticate` because login and refresh must work without a token.
 * Everything after it is authenticated; the per-route guards then narrow by capability.
 */
export function buildApiRouter(): Router {
  const router = Router();

  router.use(apiRateLimit);
  router.use('/auth', authRoutes());

  // Media bytes are authorised by a signed, expiring URL rather than a bearer header, because an
  // <Image> or audio element cannot send one. Mounted before `authenticate` for that reason.
  router.use('/attachments', publicAttachmentRoutes());
  router.use('/media', publicMediaRoutes());

  // The Digital Menu Board: a screen on a wall, opened by URL with nobody signed in. Read-only
  // and deliberately narrow — see `publicMenuBoardRoutes()` for what it does and does not carry.
  router.use('/menu-board', publicMenuBoardRoutes());

  // Same reasoning as the media bytes: a long background download of the speech model cannot
  // carry a bearer token that may expire mid-transfer, so it authorises by signed URL.
  router.use('/voice-model', publicVoiceModelRoutes());

  // Every route below requires a valid access token.
  router.use(authenticate);

  router.use('/users', userRoutes());
  router.use('/boards', boardRoutes());
  router.use('/orders', orderRoutes());

  // The Entity master (customers, employees, vendors) and the till. Their own ENTITY_*/POS_*
  // capabilities rather than MASTER_WRITE: taking money is a narrower power than editing the
  // catalogue, and a counter operator needs one without the other.
  router.use('/entities', entityRoutes());
  router.use('/pos', posRoutes());

  // The kitchen and customer displays: a read/serve projection over the till, sharing its
  // POS_READ/POS_OPERATE capabilities rather than minting its own.
  router.use('/kds', kdsRoutes());

  router.use('/attachments', attachmentRoutes());
  router.use('/notifications', notificationRoutes());
  router.use('/recipes', recipeRoutes());
  router.use('/youtube-imports', youtubeImportRoutes());
  router.use('/ingredients', ingredientRoutes());
  router.use('/ingredient-categories', ingredientCategoryRoutes());
  router.use('/shopping-lists', shoppingListRoutes());
  router.use('/alerts', alertRoutes());
  router.use('/voice-model', voiceModelRoutes());
  router.use('/sync', syncRoutes());

  // Master data: reads shared by both clients, writes Admin-only (enforced inside).
  router.use('/', masterRoutes());

  // Menu Master (menus, category/item assignments, variants, counters, printing groups,
  // modifiers, schedules) and its media library. Same MASTER_READ/MASTER_WRITE gate as above.
  router.use('/', menuMasterRoutes());
  router.use('/media', mediaRoutes());

  // Which menu each wall screen advertises, and how it presents it. Same MASTER_* gate: it is
  // a menu decision, made by whoever is trusted to edit the menu.
  router.use('/', menuBoardRoutes());

  // Tax & Compliance masters: the synchronized HSN/SAC classification data and the Tax
  // Profile master. Its own TAX_* capabilities, not MASTER_WRITE — syncing the official GST
  // dataset is a narrower, admin-only power than editing menu master data.
  router.use('/', taxRoutes());

  // Volunteer tasks: the mobile "My Tasks" screen and the portal's assignment page.
  router.use('/', taskRoutes());

  // Equipment Monitoring & Maintenance Management. One module served to both clients: the
  // asset register and floor plans here, the tickets, schedules and supplier master next to
  // them. Their own EQUIPMENT_*/MAINTENANCE_*/SUPPLIER_* capabilities, which reach further
  // down the roster than any other module — reporting a fault is an Employee's job.
  router.use('/', equipmentRoutes());
  router.use('/', maintenanceRoutes());

  // Dashboard, permissions, reports, billing, audit, settings — Admin Portal only.
  router.use('/admin', adminRoutes());

  return router;
}
