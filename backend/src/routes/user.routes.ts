import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { UserController } from '../controllers/UserController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createUserSchema,
  idParam,
  updateUserSchema,
  userListQuerySchema,
} from '../validation/schemas';

/**
 * User management. Admin Portal only.
 *
 * USER_WRITE and USER_ROLE_ASSIGN are in ANDROID_FORBIDDEN_CAPABILITIES, so an Admin signed in
 * on the mobile app receives CLIENT_NOT_PERMITTED here rather than being able to manage users.
 */
export function userRoutes(): Router {
  const router = Router();

  router.get(
    '/',
    requireCapability(Capability.USER_READ),
    validate({ query: userListQuerySchema }),
    asyncHandler(UserController.list),
  );

  router.get(
    '/:id',
    requireCapability(Capability.USER_READ),
    validate({ params: idParam }),
    asyncHandler(UserController.getById),
  );

  router.post(
    '/',
    requireCapability(Capability.USER_WRITE),
    validate({ body: createUserSchema }),
    asyncHandler(UserController.create),
  );

  router.patch(
    '/:id',
    requireCapability(Capability.USER_WRITE),
    validate({ params: idParam, body: updateUserSchema }),
    asyncHandler(UserController.update),
  );

  router.delete(
    '/:id',
    requireCapability(Capability.USER_WRITE),
    validate({ params: idParam }),
    asyncHandler(UserController.remove),
  );

  return router;
}
