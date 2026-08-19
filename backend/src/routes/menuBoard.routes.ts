import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { MenuBoardController } from '../controllers/MenuBoardController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  createMenuBoardScreenSchema,
  idParam,
  menuBoardQuerySchema,
  updateMenuBoardScreenSchema,
} from '../validation/schemas';

/**
 * The Digital Menu Board screen registry, edited from the Admin Portal.
 *
 * Under the same MASTER_READ / MASTER_WRITE gate as the rest of Menu Master: choosing which
 * menu a wall screen advertises is a menu decision, made by whoever is trusted to edit the
 * menu, and giving it a capability of its own would only mean one more box to tick before
 * anybody could use it.
 */
export function menuBoardRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.MASTER_READ);
  const write = requireCapability(Capability.MASTER_WRITE);

  router.get('/menu-board/screens', read, asyncHandler(MenuBoardController.listScreens));
  router.get(
    '/menu-board/screens/:id',
    read,
    validate({ params: idParam }),
    asyncHandler(MenuBoardController.getScreen),
  );
  router.post(
    '/menu-board/screens',
    write,
    validate({ body: createMenuBoardScreenSchema }),
    asyncHandler(MenuBoardController.createScreen),
  );
  router.patch(
    '/menu-board/screens/:id',
    write,
    validate({ params: idParam, body: updateMenuBoardScreenSchema }),
    asyncHandler(MenuBoardController.updateScreen),
  );
  router.delete(
    '/menu-board/screens/:id',
    write,
    validate({ params: idParam }),
    asyncHandler(MenuBoardController.deleteScreen),
  );

  return router;
}

/**
 * What a screen on the wall reads.
 *
 * Mounted outside the authenticated router, for the same reason `publicMediaRoutes()` is: the
 * client is a browser opened to a URL with nobody signed in and no way to hold a token. Unlike
 * the media routes there is not even a signature to check — a menu board has no user to bind
 * one to — so safety rests entirely on these three endpoints being read-only and on the
 * snapshot carrying nothing but what is already printed on the wall.
 *
 * Three endpoints and no more. `revision` exists so an idle screen costs forty bytes a minute
 * instead of a full menu, and `media` serves the photographs the snapshot names.
 */
export function publicMenuBoardRoutes(): Router {
  const router = Router();

  router.get(
    '/snapshot',
    validate({ query: menuBoardQuerySchema }),
    asyncHandler(MenuBoardController.snapshot),
  );
  router.get(
    '/revision',
    validate({ query: menuBoardQuerySchema }),
    asyncHandler(MenuBoardController.revision),
  );
  router.get('/media/:id', validate({ params: idParam }), asyncHandler(MenuBoardController.media));

  return router;
}
