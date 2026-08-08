import { Router, type Request } from 'express';
import { Capability, type UpdateShoppingListRequest } from '@menuboard/shared';
import { requireResolvedBoardAccess } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { shoppingListService } from '../services/ShoppingListService';
import { actorFrom } from '../controllers/context';
import { ok } from '../utils/http';
import { shoppingListIdParam, updateShoppingListSchema } from '../validation/schemas';

/** Resolves the board a list belongs to, for the authorisation guard. */
function boardIdForList(req: Request): Promise<string | null> {
  return shoppingListService.findBoardId(req.params.shoppingListId as string);
}

/**
 * A single shopping list, addressed by its own id.
 *
 * Generation lives on `/boards/:boardId/shopping-lists` because that is where the
 * capability is scoped; once a list exists it is a resource in its own right, and ticking
 * items off should not require the caller to know which board it came from.
 */
export function shoppingListRoutes(): Router {
  const router = Router();

  router.get(
    '/:shoppingListId',
    validate({ params: shoppingListIdParam }),
    requireResolvedBoardAccess(Capability.SHOPPING_LIST_READ, boardIdForList),
    asyncHandler(async (req, res) => {
      ok(res, await shoppingListService.getById(req.params.shoppingListId as string));
    }),
  );

  // Ticking items off is part of doing the shopping, so it needs the same capability that
  // let the list be raised — a plain member should not be able to mark the buying done.
  router.patch(
    '/:shoppingListId',
    validate({ params: shoppingListIdParam, body: updateShoppingListSchema }),
    requireResolvedBoardAccess(Capability.SHOPPING_LIST_GENERATE, boardIdForList),
    asyncHandler(async (req, res) => {
      ok(
        res,
        await shoppingListService.update(
          req.params.shoppingListId as string,
          req.body as UpdateShoppingListRequest,
          actorFrom(req),
        ),
      );
    }),
  );

  return router;
}
