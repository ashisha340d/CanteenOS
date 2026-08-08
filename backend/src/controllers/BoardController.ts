import type { Request, Response } from 'express';
import type {
  CreateBoardRequest,
  CreateThreadMessageRequest,
  GenerateShoppingListRequest,
  UpdateBoardRequest,
  UpsertBoardMemberRequest,
} from '@menuboard/shared';
import { boardService, type BoardQuery } from '../services/BoardService';
import { shoppingListService } from '../services/ShoppingListService';
import { threadService } from '../services/ThreadService';
import { requireAuth } from '../middleware/types';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

export const BoardController = {
  async list(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const query = req.query as unknown as BoardQuery & { withCounts?: boolean };
    paginated(
      res,
      await boardService.list(auth, query, {
        ...(query.withCounts !== undefined ? { withCounts: query.withCounts } : {}),
      }),
    );
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await boardService.getById(req.params.boardId as string));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await boardService.create(req.body as CreateBoardRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await boardService.update(
        req.params.boardId as string,
        req.body as UpdateBoardRequest,
        actorFrom(req),
      ),
    );
  },

  async archive(req: Request, res: Response): Promise<void> {
    ok(res, await boardService.archive(req.params.boardId as string, actorFrom(req)));
  },

  async listMembers(req: Request, res: Response): Promise<void> {
    ok(res, await boardService.listMembers(req.params.boardId as string));
  },

  async listEligibleMembers(req: Request, res: Response): Promise<void> {
    const { search } = req.query as { search?: string };
    ok(res, await boardService.listEligibleMembers(req.params.boardId as string, search));
  },

  /* ---------------------------------------------------------- board feed */

  async listFeed(req: Request, res: Response): Promise<void> {
    const query = req.query as unknown as { limit?: number; before?: string };
    ok(
      res,
      await threadService.listForBoard(req.params.boardId as string, {
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.before !== undefined ? { before: query.before } : {}),
      }),
    );
  },

  async postFeedMessage(req: Request, res: Response): Promise<void> {
    const body = req.body as CreateThreadMessageRequest;
    created(
      res,
      await threadService.post(
        { boardId: req.params.boardId as string, orderId: body.orderId ?? null },
        body,
        actorFrom(req),
      ),
    );
  },

  /* ------------------------------------------------------- shopping lists */

  async listShoppingLists(req: Request, res: Response): Promise<void> {
    ok(res, await shoppingListService.listForBoard(req.params.boardId as string));
  },

  async generateShoppingList(req: Request, res: Response): Promise<void> {
    created(
      res,
      await shoppingListService.generate(
        req.params.boardId as string,
        req.body as GenerateShoppingListRequest,
        actorFrom(req) as ReturnType<typeof actorFrom> & { userId: string },
      ),
    );
  },

  async upsertMember(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await boardService.upsertMember(
        req.params.boardId as string,
        req.body as UpsertBoardMemberRequest,
        actorFrom(req),
      ),
    );
  },

  async removeMember(req: Request, res: Response): Promise<void> {
    await boardService.removeMember(
      req.params.boardId as string,
      req.params.userId as string,
      actorFrom(req),
    );
    noContent(res);
  },
};
