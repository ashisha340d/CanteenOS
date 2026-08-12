import type { Request, Response } from 'express';
import { Capability, type TaskCreateRequest, type TaskListQuery, type TaskUpdateRequest } from '@menuboard/shared';
import { taskService } from '../services/TaskService';
import { created, noContent, ok, paginated } from '../utils/http';
import { ForbiddenError } from '../utils/errors';
import { requireAuth } from '../middleware/types';
import { actorFrom } from './context';

/** Whether the caller may act on somebody else's task. */
function canAssign(req: Request): boolean {
  return requireAuth(req).capabilities.includes(Capability.TASK_ASSIGN);
}

/**
 * Volunteer tasks. Reads and self-service are open to everyone; assigning work to somebody
 * else needs TASK_ASSIGN, which is checked here rather than at the route because the same
 * endpoint serves both cases — a task with no `assignedTo` is self-assigned by definition.
 */
export const TaskController = {
  async myTasks(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.myTasks(actorFrom(req).userId));
  },

  async teamActivity(_req: Request, res: Response): Promise<void> {
    ok(res, await taskService.teamActivity());
  },

  async list(req: Request, res: Response): Promise<void> {
    paginated(res, await taskService.list(req.query as TaskListQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.getById(req.params.id as string));
  },

  async create(req: Request, res: Response): Promise<void> {
    const actor = actorFrom(req);
    const body = req.body as TaskCreateRequest;
    if (body.assignedTo !== undefined && body.assignedTo !== actor.userId && !canAssign(req)) {
      throw new ForbiddenError('You can only create tasks for yourself');
    }
    created(res, await taskService.create(body, actor));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await taskService.update(
        req.params.id as string,
        req.body as TaskUpdateRequest,
        actorFrom(req),
        canAssign(req),
      ),
    );
  },

  async start(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.start(req.params.id as string, actorFrom(req)));
  },

  async stop(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.stop(req.params.id as string, actorFrom(req)));
  },

  async complete(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.complete(req.params.id as string, actorFrom(req)));
  },

  async cancel(req: Request, res: Response): Promise<void> {
    ok(res, await taskService.cancel(req.params.id as string, actorFrom(req), canAssign(req)));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await taskService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
