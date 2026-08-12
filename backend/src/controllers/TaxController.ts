import type { Request, Response } from 'express';
import type {
  HsnSacCodeType,
  MasterStatus,
  TaxProfileWriteRequest,
} from '@menuboard/shared';
import { gstSyncService } from '../services/GstSyncService';
import { taxService } from '../services/TaxService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Tax & Compliance masters. Reads are open to TAX_READ (everyone who reads masters, so the
 * Food Item screen can offer a profile and an HSN/SAC selector); every write and the
 * synchronization itself are gated on administrator-only capabilities at the route.
 */
export const TaxController = {
  /* ---------------------------------------------- HSN/SAC classification master */

  async searchHsnSac(req: Request, res: Response): Promise<void> {
    const query = req.query as {
      q?: string;
      codeType?: HsnSacCodeType;
      activeOnly?: boolean;
      page?: number;
      pageSize?: number;
    };
    paginated(res, await taxService.searchHsnSac(query));
  },

  async getHsnSacById(req: Request, res: Response): Promise<void> {
    ok(res, await taxService.getHsnSacById(req.params.id as string));
  },

  async getSummary(_req: Request, res: Response): Promise<void> {
    ok(res, await gstSyncService.getSummary());
  },

  /* ------------------------------------------------------------- synchronization */

  async sync(req: Request, res: Response): Promise<void> {
    ok(res, await gstSyncService.sync(actorFrom(req)));
  },

  async listSyncRuns(req: Request, res: Response): Promise<void> {
    const query = req.query as { page?: number; pageSize?: number };
    paginated(res, await gstSyncService.listRuns(query));
  },

  async getSyncRun(req: Request, res: Response): Promise<void> {
    ok(res, await gstSyncService.getRun(req.params.id as string));
  },

  /* ------------------------------------------------------------- tax profiles */

  async listProfiles(req: Request, res: Response): Promise<void> {
    const query = req.query as {
      search?: string;
      status?: MasterStatus;
      page?: number;
      pageSize?: number;
    };
    paginated(res, await taxService.listProfiles(query));
  },

  async getProfile(req: Request, res: Response): Promise<void> {
    ok(res, await taxService.getProfile(req.params.id as string));
  },

  async createProfile(req: Request, res: Response): Promise<void> {
    const body = req.body as TaxProfileWriteRequest;
    created(res, await taxService.createProfile(body, actorFrom(req)));
  },

  async updateProfile(req: Request, res: Response): Promise<void> {
    const body = req.body as Partial<TaxProfileWriteRequest>;
    ok(res, await taxService.updateProfile(req.params.id as string, body, actorFrom(req)));
  },

  async deleteProfile(req: Request, res: Response): Promise<void> {
    await taxService.deleteProfile(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
