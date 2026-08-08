import {
  MessageType,
  ShoppingListStatus,
  scaleQuantity,
  SystemEvent,
  type GenerateShoppingListRequest,
  type ShoppingListDto,
  type UpdateShoppingListRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapShoppingList } from '../models/mappers';
import type { ShoppingListItemRow, ShoppingListRow } from '../models/rows';
import { menuItemRepository } from '../repositories/MasterRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { recipeRepository } from '../repositories/RecipeRepository';
import { shoppingListRepository } from '../repositories/ShoppingListRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/** A rolled-up requirement, keyed by ingredient and unit. */
interface AggregatedIngredient {
  name: string;
  unit: string;
  quantity: number;
  sourceOrderIds: Set<string>;
}

/**
 * ShoppingListService scales against each menu item's *default* recipe variant — a menu
 * item may have several authored variants (e.g. three kinds of Roti), and exactly one of
 * them is `is_default` (see migration 005 / RecipeRepository). A device offline cannot
 * compute this roll-up, which is why shopping lists are absent from PUSHABLE_ENTITIES.
 */

/**
 * Shopping lists.
 *
 * Generating one walks every live line on the chosen orders, looks up each menu item's
 * recipe, scales its ingredients by how many servings of that item were ordered, then sums
 * identical ingredient/unit pairs across the whole selection. The result is what a Manager
 * takes to the market.
 *
 * Generation is also what stamps `orders.shopping_generated_at`, which is what puts the On
 * Shopping pill on those orders — the specification's "when a shopping list is
 * processed/generated, show the order status as On Shopping".
 */
export class ShoppingListService {
  async listForBoard(boardId: string): Promise<ShoppingListDto[]> {
    const pool = getPool();
    const rows = await shoppingListRepository.listForBoard(pool, boardId, { limit: 50 });
    return this.withItems(pool, rows);
  }

  async getById(id: string): Promise<ShoppingListDto> {
    const pool = getPool();
    const row = await shoppingListRepository.findById(pool, id);
    if (row === null) throw new NotFoundError('Shopping list', id);
    const [list] = await this.withItems(pool, [row]);
    if (list === undefined) throw new NotFoundError('Shopping list', id);
    return list;
  }

  /** Board id for a list — used by authorisation middleware before the handler runs. */
  async findBoardId(id: string): Promise<string | null> {
    const row = await shoppingListRepository.findById(getPool(), id);
    return row === null ? null : row.board_id;
  }

  async generate(
    boardId: string,
    input: GenerateShoppingListRequest,
    actor: AuditActor & { userId: string },
  ): Promise<ShoppingListDto> {
    if (input.orderIds.length === 0) {
      throw new ValidationError('Choose at least one order', [
        { path: 'orderIds', message: 'A shopping list is generated from one or more orders' },
      ]);
    }

    const listId = await withTransaction(async (connection) => {
      const orders = [];
      for (const orderId of input.orderIds) {
        const order = await orderRepository.findById(connection, orderId);
        if (order === null) throw new NotFoundError('Order', orderId);
        // The route is keyed on the board, so an order from elsewhere would silently widen
        // the caller's reach past what the guard checked.
        if (order.board_id !== boardId) {
          throw new ValidationError('Every order must belong to this board', [
            { path: 'orderIds', message: `Order ${order.order_number} is on a different board` },
          ]);
        }
        orders.push(order);
      }

      const aggregated = new Map<string, AggregatedIngredient>();
      const missingRecipes = new Set<string>();

      for (const order of orders) {
        const items = await orderRepository.listItems(connection, order.id);
        // Cancelled lines are struck through on the card and must not be bought. Ad-hoc lines
        // (custom_item_name, no menu_item_id) have no recipe by definition, so they cannot be
        // exploded into ingredients — they are reported as unbuyable rather than silently
        // dropped, so whoever shops knows to source them by hand.
        const live = items.filter((item) => item.cancelled_at === null);
        if (live.length === 0) continue;

        const catalogued = live.filter(
          (item): item is typeof item & { menu_item_id: string } => item.menu_item_id !== null,
        );
        for (const item of live) {
          if (item.menu_item_id === null && item.custom_item_name !== null) {
            missingRecipes.add(item.custom_item_name);
          }
        }
        if (catalogued.length === 0) continue;

        const recipes = await recipeRepository.findDefaultByMenuItemIds(
          connection,
          catalogued.map((item) => item.menu_item_id),
        );
        const recipeByMenuItem = new Map(recipes.map((recipe) => [recipe.menu_item_id, recipe]));
        const ingredientsByRecipe = await this.ingredientsByRecipe(
          connection,
          recipes.map((recipe) => recipe.id),
        );

        for (const item of catalogued) {
          const recipe = recipeByMenuItem.get(item.menu_item_id);
          if (recipe === undefined) {
            missingRecipes.add(item.menu_item_id);
            continue;
          }

          // The line's quantity is how many servings of that dish were ordered, so it scales
          // against the recipe's own base serving count — respecting each ingredient's own
          // scaling mode (linear/fixed/sqrt), same formula the long-press view uses.
          const targetPax = Number(item.quantity);
          const basePax = Number(recipe.base_pax);
          for (const ingredient of ingredientsByRecipe.get(recipe.id) ?? []) {
            const name = (ingredient.ingredient_name ?? '').trim();
            if (!name) continue;
            const key = `${name.toLowerCase()}::${ingredient.unit.toLowerCase()}`;
            const existing = aggregated.get(key);
            const amount = scaleQuantity(Number(ingredient.quantity), basePax, targetPax, ingredient.scaling);
            if (existing === undefined) {
              aggregated.set(key, {
                name,
                unit: ingredient.unit,
                quantity: amount,
                sourceOrderIds: new Set([order.id]),
              });
            } else {
              existing.quantity += amount;
              existing.sourceOrderIds.add(order.id);
            }
          }
        }
      }

      if (aggregated.size === 0) {
        const names = await menuItemRepository.findByIds(connection, [...missingRecipes]);
        throw new ConflictError(
          missingRecipes.size > 0
            ? `No recipes are on file for ${names.map((row) => row.name).join(', ')}, so nothing can be listed`
            : 'These orders have no live items, so there is nothing to buy',
        );
      }

      const list = await shoppingListRepository.insert(connection, {
        id: newId(),
        boardId,
        title: input.title ?? defaultTitle(orders.length),
        orderIds: orders.map((order) => order.id),
        notes: input.notes ?? null,
        generatedBy: actor.userId,
      });

      const sorted = [...aggregated.values()].sort((a, b) => a.name.localeCompare(b.name));
      await shoppingListRepository.insertItems(
        connection,
        list.id,
        sorted.map((ingredient, index) => ({
          id: newId(),
          ingredientName: ingredient.name,
          // Three decimals to match the DECIMAL(12,3) the quantities were read from.
          quantity: Math.round(ingredient.quantity * 1000) / 1000,
          unit: ingredient.unit,
          notes: null,
          sortOrder: index,
          sourceOrderIds: [...ingredient.sourceOrderIds],
        })),
      );

      await orderRepository.markShoppingGenerated(
        connection,
        orders.map((order) => order.id),
      );

      // One line in each order's feed, so the pill change is explained where people read.
      for (const order of orders) {
        await threadRepository.insert(connection, {
          id: newId(),
          boardId,
          orderId: order.id,
          parentMessageId: null,
          authorId: null,
          messageType: MessageType.SYSTEM,
          body: null,
          mentionedUserIds: [],
          systemEvent: SystemEvent.SHOPPING_LIST_GENERATED,
          systemMeta: {
            shoppingListId: list.id,
            title: list.title,
            itemCount: sorted.length,
            generatedBy: actor.userId,
            ...(missingRecipes.size > 0 ? { menuItemsWithoutRecipe: [...missingRecipes] } : {}),
          },
        });
      }

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'shopping_list',
        entityId: list.id,
        boardId,
        after: {
          orderIds: orders.map((order) => order.id),
          itemCount: sorted.length,
          menuItemsWithoutRecipe: [...missingRecipes],
        },
      });

      return list.id;
    });

    // A hint only — the device pulls the list, its items and the restamped orders itself.
    const list = await this.getById(listId);
    realtime.emitBoardChange(
      boardId,
      ['shopping_lists', 'shopping_list_items', 'orders', 'thread_messages'],
      list.syncSeq,
    );
    return list;
  }

  async update(
    id: string,
    input: UpdateShoppingListRequest,
    actor: AuditActor,
  ): Promise<ShoppingListDto> {
    await withTransaction(async (connection) => {
      const before = await shoppingListRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Shopping list', id);

      if (input.status !== undefined && input.status !== before.status) {
        if (before.status !== ShoppingListStatus.OPEN) {
          throw new ConflictError(
            `This list is ${before.status.toLowerCase()} and can no longer change state`,
          );
        }
        await shoppingListRepository.updateStatus(connection, id, input.status);
      }
      if (input.notes !== undefined) {
        await shoppingListRepository.updateNotes(connection, id, input.notes);
      }
      for (const item of input.items ?? []) {
        await shoppingListRepository.updateItem(connection, item.itemId, {
          ...(item.purchased !== undefined ? { purchased: item.purchased } : {}),
          ...(item.quantity !== undefined ? { quantity: item.quantity } : {}),
        });
      }

      await auditService.record(connection, actor, {
        action: AuditAction.ORDER_UPDATED,
        entityType: 'shopping_list',
        entityId: id,
        boardId: before.board_id,
        before: { status: before.status },
        after: { status: input.status ?? before.status },
      });
    });

    return this.getById(id);
  }

  private async ingredientsByRecipe(db: Db, recipeIds: readonly string[]) {
    const rows = await recipeRepository.listIngredientsForRecipes(db, recipeIds);
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = map.get(row.recipe_id) ?? [];
      list.push(row);
      map.set(row.recipe_id, list);
    }
    return map;
  }

  private async withItems(db: Db, rows: ShoppingListRow[]): Promise<ShoppingListDto[]> {
    if (rows.length === 0) return [];
    const items = await shoppingListRepository.listItemsForLists(
      db,
      rows.map((row) => row.id),
    );
    const byList = new Map<string, ShoppingListItemRow[]>();
    for (const item of items) {
      const list = byList.get(item.shopping_list_id) ?? [];
      list.push(item);
      byList.set(item.shopping_list_id, list);
    }
    return rows.map((row) => mapShoppingList(row, byList.get(row.id) ?? []));
  }
}

function defaultTitle(orderCount: number): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Shopping · ${today} · ${orderCount} order${orderCount === 1 ? '' : 's'}`;
}

export const shoppingListService = new ShoppingListService();
