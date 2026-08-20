import type { Request, Response } from 'express';
import type { SendCounterMessageRequest } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { requireAuth } from '../middleware/types';
import { userRepository } from '../repositories/UserRepository';
import { counterChatService, sideFor } from '../services/CounterChatService';
import { created, ok } from '../utils/http';

/**
 * The sender's display name, read once per send. Stored on the message rather than joined on
 * read so a thread still says who spoke after that person has left the roster.
 */
async function senderName(userId: string): Promise<string | null> {
  const user = await userRepository.findById(getPool(), userId);
  return user?.name ?? null;
}

export const CounterChatController = {
  /** The admin's counter list: every counter, its last word, and what is waiting. */
  async summaries(_req: Request, res: Response): Promise<void> {
    ok(res, await counterChatService.summaries());
  },

  async thread(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(res, await counterChatService.thread(req.params.counterId as string, sideFor(auth.clientType)));
  },

  async send(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const body = req.body as SendCounterMessageRequest;
    created(
      res,
      await counterChatService.send(
        req.params.counterId as string,
        sideFor(auth.clientType),
        { body: body.body, orderId: body.orderId ?? null },
        { userId: auth.userId, name: await senderName(auth.userId) },
      ),
    );
  },

  async ringBell(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    created(
      res,
      await counterChatService.ringBell(req.params.counterId as string, sideFor(auth.clientType), {
        userId: auth.userId,
        name: await senderName(auth.userId),
      }),
    );
  },

  async markRead(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(
      res,
      await counterChatService.markRead(req.params.counterId as string, sideFor(auth.clientType)),
    );
  },

  /** Ends a ring in progress — the office hanging up. */
  async hangUp(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(
      res,
      await counterChatService.hangUp(req.params.counterId as string, sideFor(auth.clientType)),
    );
  },

  /** Hindi for one message, fetched on demand by the board's auto-translate switch. */
  async translate(req: Request, res: Response): Promise<void> {
    ok(res, await counterChatService.translateMessage(req.params.messageId as string));
  },

  /** Empties a counter's thread. The office only; the service enforces that. */
  async clear(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(
      res,
      await counterChatService.clearThread(
        req.params.counterId as string,
        sideFor(auth.clientType),
      ),
    );
  },

  /** Which order cards on this counter's board carry a message. */
  async orderTags(req: Request, res: Response): Promise<void> {
    ok(res, await counterChatService.orderTags(req.params.counterId as string));
  },
};
