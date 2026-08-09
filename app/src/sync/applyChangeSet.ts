import { SYNC_ENTITIES } from '@menuboard/shared';
import type { SyncChangeSet } from '@menuboard/shared';
import type * as SQLite from 'expo-sqlite';
import {
  acknowledgementRepository,
  alertSettingsRepository,
  attachmentRepository,
  boardRepository,
  ingredientRepository,
  masterRepository,
  notificationRepository,
  orderRepository,
  recipeRepository,
  shoppingRepository,
  threadRepository,
  userRepository,
} from '../db/repositories';

/**
 * Applies a server change set to SQLite in dependency order inside a single transaction.
 * The caller (pull worker) is responsible for beginning the transaction and advancing the
 * cursor only after this function returns successfully.
 */
export async function applyChangeSet(
  changes: SyncChangeSet,
  tx: SQLite.SQLiteDatabase,
): Promise<void> {
  for (const entity of SYNC_ENTITIES) {
    try {
      switch (entity) {
        case 'users':
          await userRepository.upsertMany(changes.users, tx);
          break;
        case 'boards':
          await boardRepository.upsertMany(changes.boards, tx);
          break;
        case 'board_members':
          await boardRepository.upsertMembers(changes.board_members, tx);
          break;
        case 'stations':
          await masterRepository.replaceStations(changes.stations, tx);
          break;
        case 'activity_types':
          await masterRepository.replaceActivityTypes(changes.activity_types, tx);
          break;
        case 'menu_categories':
          await masterRepository.replaceMenuCategories(changes.menu_categories, tx);
          break;
        case 'menu_items':
          await masterRepository.replaceMenuItems(changes.menu_items, tx);
          break;
        case 'ingredients':
          await ingredientRepository.upsertMany(changes.ingredients, tx);
          break;
        case 'recipes':
          await recipeRepository.upsertMany(changes.recipes, tx);
          break;
        case 'recipe_ingredients':
          await recipeRepository.upsertIngredients(changes.recipe_ingredients, tx);
          break;
        case 'recipe_steps':
          await recipeRepository.upsertSteps(changes.recipe_steps, tx);
          break;
        case 'orders':
          await orderRepository.upsertMany(changes.orders, tx);
          break;
        case 'order_items':
          await orderRepository.upsertItems(changes.order_items, tx);
          break;
        case 'attachments': {
          const localPaths = await attachmentRepository.localPathsForIds(
            changes.attachments.map((a) => a.id),
          );
          await attachmentRepository.upsertMany(changes.attachments, localPaths, tx);
          break;
        }
        case 'thread_messages':
          await threadRepository.upsertMany(changes.thread_messages, tx);
          break;
        case 'acknowledgements':
          await acknowledgementRepository.upsertMany(changes.acknowledgements, tx);
          break;
        case 'shopping_lists':
          await shoppingRepository.upsertMany(changes.shopping_lists, tx);
          break;
        case 'shopping_list_items':
          await shoppingRepository.upsertItems(changes.shopping_list_items, tx);
          break;
        case 'alert_settings':
          await alertSettingsRepository.upsertMany(changes.alert_settings, tx);
          break;
        case 'notifications':
          await notificationRepository.upsertMany(changes.notifications, tx);
          break;
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[SYNC] applyChangeSet failed on entity '${entity}': ${message}`);
      throw error;
    }
  }
}
