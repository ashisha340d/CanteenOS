import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { TaskController } from '../controllers/TaskController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createTaskSchema,
  idParam,
  taskListQuerySchema,
  updateTaskSchema,
} from '../validation/schemas';

/**
 * Volunteer tasks — the "My Tasks" screen and the Admin Portal's assignment page.
 *
 * Three capabilities, not one, cover what used to be a single TASK_SELF:
 *  - TASK_SELF authors a task — for yourself, or (combined with TASK_ASSIGN) for somebody
 *    else. User, Manager, Admin. Never Employee, never Super Admin.
 *  - TASK_ASSIGN hands work to somebody else, enforced inside the controller because
 *    `POST /tasks` legitimately serves both the self- and other-assignment case.
 *  - TASK_WORK starts, stops and finishes a task already assigned to you — Employee's own
 *    capability, and everyone above them, since carrying out assigned work is universal even
 *    where authoring it is not.
 */
export function taskRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.TASK_READ);
  const author = requireCapability(Capability.TASK_SELF);
  const work = requireCapability(Capability.TASK_WORK);
  const assign = requireCapability(Capability.TASK_ASSIGN);

  router.get('/tasks/mine', read, asyncHandler(TaskController.myTasks));
  router.get('/tasks/team-activity', read, asyncHandler(TaskController.teamActivity));

  router.get(
    '/tasks',
    read,
    validate({ query: taskListQuerySchema }),
    asyncHandler(TaskController.list),
  );
  router.get('/tasks/:id', read, validate({ params: idParam }), asyncHandler(TaskController.getById));

  router.post('/tasks', author, validate({ body: createTaskSchema }), asyncHandler(TaskController.create));
  router.patch(
    '/tasks/:id',
    author,
    validate({ params: idParam, body: updateTaskSchema }),
    asyncHandler(TaskController.update),
  );

  router.post('/tasks/:id/start', work, validate({ params: idParam }), asyncHandler(TaskController.start));
  router.post('/tasks/:id/stop', work, validate({ params: idParam }), asyncHandler(TaskController.stop));
  router.post(
    '/tasks/:id/complete',
    work,
    validate({ params: idParam }),
    asyncHandler(TaskController.complete),
  );
  router.post('/tasks/:id/cancel', work, validate({ params: idParam }), asyncHandler(TaskController.cancel));

  router.delete('/tasks/:id', assign, validate({ params: idParam }), asyncHandler(TaskController.remove));

  return router;
}
