import type { Request, Response } from 'express';
import type { CreateUserRequest, UpdateUserRequest } from '@menuboard/shared';
import { userService, type UserQuery } from '../services/UserService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/** Admin Portal only — the routes are guarded by USER_READ / USER_WRITE. */
export const UserController = {
  async list(req: Request, res: Response): Promise<void> {
    paginated(res, await userService.list(req.query as unknown as UserQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await userService.getById(req.params.id as string));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await userService.create(req.body as CreateUserRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await userService.update(
        req.params.id as string,
        req.body as UpdateUserRequest,
        actorFrom(req),
      ),
    );
  },

  async remove(req: Request, res: Response): Promise<void> {
    await userService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
