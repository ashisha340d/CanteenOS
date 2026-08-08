import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { BoardController } from '../controllers/BoardController';
import { requireBoardAccess, requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  boardEligibleMembersQuerySchema,
  boardIdParam,
  boardListQuerySchema,
  boardMemberParamSchema,
  createBoardSchema,
  createThreadMessageSchema,
  generateShoppingListSchema,
  threadListQuerySchema,
  updateBoardSchema,
  upsertBoardMemberSchema,
} from '../validation/schemas';

/**
 * Boards.
 *
 * Reads are scoped inside the service: administrators see every board, everyone else only their
 * memberships. Writes go through `requireBoardAccess`, which accepts either a global capability
 * or the caller's board role.
 */
export function boardRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    validate({ query: boardListQuerySchema }),
    asyncHandler(BoardController.list),
  );

  router.post(
    '/',
    requireCapability(Capability.BOARD_CREATE),
    validate({ body: createBoardSchema }),
    asyncHandler(BoardController.create),
  );

  router.get(
    '/:boardId',
    validate({ params: boardIdParam }),
    requireBoardAccess(Capability.ORDER_READ),
    asyncHandler(BoardController.getById),
  );

  router.patch(
    '/:boardId',
    validate({ params: boardIdParam, body: updateBoardSchema }),
    requireBoardAccess(Capability.BOARD_UPDATE),
    asyncHandler(BoardController.update),
  );

  router.post(
    '/:boardId/archive',
    validate({ params: boardIdParam }),
    requireBoardAccess(Capability.BOARD_ARCHIVE),
    asyncHandler(BoardController.archive),
  );

  router.get(
    '/:boardId/members',
    validate({ params: boardIdParam }),
    requireBoardAccess(Capability.ORDER_READ),
    asyncHandler(BoardController.listMembers),
  );

  router.put(
    '/:boardId/members',
    validate({ params: boardIdParam, body: upsertBoardMemberSchema }),
    requireBoardAccess(Capability.BOARD_MEMBER_MANAGE),
    asyncHandler(BoardController.upsertMember),
  );

  router.delete(
    '/:boardId/members/:userId',
    validate({ params: boardMemberParamSchema }),
    requireBoardAccess(Capability.BOARD_MEMBER_MANAGE),
    asyncHandler(BoardController.removeMember),
  );

  // Board-scoped rather than reusing GET /users, whose global USER_READ capability a board
  // OWNER/MANAGER with a plain USER global role does not hold.
  router.get(
    '/:boardId/eligible-members',
    validate({ params: boardIdParam, query: boardEligibleMembersQuerySchema }),
    requireBoardAccess(Capability.BOARD_MEMBER_MANAGE),
    asyncHandler(BoardController.listEligibleMembers),
  );

  // The board feed: the same thread_messages entity as the order routes, read board-wide.
  router.get(
    '/:boardId/messages',
    validate({ params: boardIdParam, query: threadListQuerySchema }),
    requireBoardAccess(Capability.THREAD_READ),
    asyncHandler(BoardController.listFeed),
  );

  router.post(
    '/:boardId/messages',
    validate({ params: boardIdParam, body: createThreadMessageSchema }),
    requireBoardAccess(Capability.THREAD_POST),
    asyncHandler(BoardController.postFeedMessage),
  );

  /* ------------------------------------------------------- shopping lists */

  // Board-scoped because a list rolls up orders from exactly one board, and the Manager who
  // raises it must hold SHOPPING_LIST_GENERATE on that board.
  router.get(
    '/:boardId/shopping-lists',
    validate({ params: boardIdParam }),
    requireBoardAccess(Capability.SHOPPING_LIST_READ),
    asyncHandler(BoardController.listShoppingLists),
  );

  router.post(
    '/:boardId/shopping-lists',
    validate({ params: boardIdParam, body: generateShoppingListSchema }),
    requireBoardAccess(Capability.SHOPPING_LIST_GENERATE),
    asyncHandler(BoardController.generateShoppingList),
  );

  return router;
}
