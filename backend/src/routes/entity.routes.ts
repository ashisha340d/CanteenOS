import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { EntityController } from '../controllers/EntityController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createEntitySchema,
  entityListQuerySchema,
  idParam,
  updateEntitySchema,
} from '../validation/schemas';

/**
 * The Entity master.
 *
 * ENTITY_READ is held from USER upwards, because a counter operator has to be able to find
 * the customer they are billing. ENTITY_WRITE starts at Manager: registering a party into the
 * master, and especially setting their discount and credit limit, is a supervisory act.
 */
export function entityRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.ENTITY_READ);
  const write = requireCapability(Capability.ENTITY_WRITE);

  router.get('/', read, validate({ query: entityListQuerySchema }), asyncHandler(EntityController.list));
  router.get('/lookup', read, asyncHandler(EntityController.lookupByPhone));
  router.get('/:id', read, validate({ params: idParam }), asyncHandler(EntityController.getById));
  router.post('/', write, validate({ body: createEntitySchema }), asyncHandler(EntityController.create));
  router.patch(
    '/:id',
    write,
    validate({ params: idParam, body: updateEntitySchema }),
    asyncHandler(EntityController.update),
  );
  router.delete('/:id', write, validate({ params: idParam }), asyncHandler(EntityController.remove));

  return router;
}
