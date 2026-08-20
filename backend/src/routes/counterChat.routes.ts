import { Router } from 'express';
import { Capability } from '@menuboard/shared';
import { CounterChatController } from '../controllers/CounterChatController';
import { requireCapability } from '../middleware/authorize';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import {
  counterMessageParam,
  counterMessageSchema,
  kdsCounterIdParam,
} from '../validation/schemas';

/**
 * Admin ↔ counter messaging.
 *
 * Gated on POS_READ, the same capability the KDS boards use: whoever is trusted to watch a
 * counter's board is trusted to talk to it, and the office side of the conversation is held by
 * managers who hold that capability many times over.
 *
 * Which *side* a caller speaks as is never a routing decision — it comes from the client type
 * in the access token (see `sideFor`), so a wall display cannot post as the office by calling a
 * different URL.
 */
export function counterChatRoutes(): Router {
  const router = Router();
  const read = requireCapability(Capability.POS_READ);

  router.get('/', read, asyncHandler(CounterChatController.summaries));

  router.get(
    '/:counterId',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.thread),
  );

  router.get(
    '/:counterId/order-tags',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.orderTags),
  );

  router.post(
    '/:counterId/messages',
    read,
    validate({ params: kdsCounterIdParam, body: counterMessageSchema }),
    asyncHandler(CounterChatController.send),
  );

  // The bell has no body — it is a summons, not a message. The service refuses it from the
  // counter side, so this stays one route rather than two.
  router.post(
    '/:counterId/bell',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.ringBell),
  );

  // Hanging up. Same gate as ringing: it is the other half of the same action.
  router.post(
    '/:counterId/bell/hangup',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.hangUp),
  );

  // Translate-on-demand. A read-shaped action that happens to write a cache column, so it
  // keeps the read capability: the board asking to understand a message it can already see
  // is not a privileged operation.
  router.post(
    '/:counterId/messages/:messageId/translate',
    read,
    validate({ params: counterMessageParam }),
    asyncHandler(CounterChatController.translate),
  );

  // Clearing is a write against a whole thread, so it takes the operate capability rather
  // than the read one every other route here uses.
  router.delete(
    '/:counterId/messages',
    requireCapability(Capability.POS_OPERATE),
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.clear),
  );

  router.post(
    '/:counterId/read',
    read,
    validate({ params: kdsCounterIdParam }),
    asyncHandler(CounterChatController.markRead),
  );

  return router;
}
