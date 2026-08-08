import type { Request, Response } from 'express';
import type { SyncPullRequest, SyncPushRequest } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { currentSyncSeq } from '../db/syncSeq';
import { syncService } from '../services/SyncService';
import { ok } from '../utils/http';
import { actorFrom } from './context';

export const SyncController = {
  async push(req: Request, res: Response): Promise<void> {
    ok(res, await syncService.push(req.body as SyncPushRequest, actorFrom(req)));
  },

  async pull(req: Request, res: Response): Promise<void> {
    ok(res, await syncService.pull(req.body as SyncPullRequest, actorFrom(req)));
  },

  /**
   * Current server cursor and time. Lets a device decide whether a pull is worth making, and
   * measure its own clock skew before it stamps `clientTimestamp` on queued operations.
   */
  async status(_req: Request, res: Response): Promise<void> {
    const cursor = await currentSyncSeq(getPool());
    ok(res, { cursor, serverTime: new Date().toISOString() });
  },
};
