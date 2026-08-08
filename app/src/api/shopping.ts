import type { ShoppingListDto } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

/**
 * Shopping list generation.
 *
 * The one deliberately **online-only** write in the app. Everything else here is local-first,
 * but a shopping list is not a record of what the user did — it is a computation the server
 * performs: it explodes each order line into its default recipe, scales every ingredient
 * against the order's pax, and aggregates the result across orders. The device holds recipes
 * as a read-only cache and has no aggregation logic, so generating one offline would either
 * produce a different answer from the server or need the whole scaling engine duplicated.
 *
 * Callers must therefore handle failure as a normal outcome, not an exception: the button
 * that triggers this is disabled while offline.
 */
export const shoppingApi = {
  async generate(
    boardId: string,
    input: { orderIds: string[]; title?: string; notes?: string | null },
  ): Promise<ShoppingListDto> {
    const response = await apiClient.post(`/boards/${boardId}/shopping-lists`, input);
    return unwrap(response);
  },
};
