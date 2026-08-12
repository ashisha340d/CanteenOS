import type { Request, Response } from 'express';
import type { EntityWriteRequest } from '@menuboard/shared';
import { entityService, type EntityQuery } from '../services/EntityService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * The Entity master — customers, employees, vendors. Reads need ENTITY_READ (every counter
 * operator holds it); writes need ENTITY_WRITE, which starts at Manager.
 */
export const EntityController = {
  async list(req: Request, res: Response): Promise<void> {
    paginated(res, await entityService.list(req.query as unknown as EntityQuery));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await entityService.getById(req.params.id as string));
  },

  /** A miss is an ordinary answer at the counter, so this returns null rather than 404. */
  async lookupByPhone(req: Request, res: Response): Promise<void> {
    const { phone } = req.query as { phone?: string };
    ok(res, phone === undefined ? null : await entityService.findByPhone(phone));
  },

  async create(req: Request, res: Response): Promise<void> {
    created(res, await entityService.create(req.body as EntityWriteRequest, actorFrom(req)));
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await entityService.update(
        req.params.id as string,
        req.body as Partial<EntityWriteRequest>,
        actorFrom(req),
      ),
    );
  },

  async remove(req: Request, res: Response): Promise<void> {
    await entityService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
