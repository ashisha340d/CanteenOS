import type { Request, Response } from 'express';
import type { YoutubeImportStatus } from '@menuboard/shared';
import { youtubeImportService } from '../services/YoutubeImportService';
import { created, noContent, ok } from '../utils/http';
import { actorFrom } from './context';

export const YoutubeImportController = {
  async list(req: Request, res: Response): Promise<void> {
    const { status } = req.query as { status?: YoutubeImportStatus };
    ok(res, await youtubeImportService.list(status !== undefined ? { status } : {}));
  },

  async getById(req: Request, res: Response): Promise<void> {
    ok(res, await youtubeImportService.getById(req.params.id as string));
  },

  /** Creates the import record and returns immediately; processing happens in the background. */
  async create(req: Request, res: Response): Promise<void> {
    const { url } = req.body as { url: string };
    created(res, await youtubeImportService.create(url, actorFrom(req)));
  },

  async retry(req: Request, res: Response): Promise<void> {
    ok(res, await youtubeImportService.retry(req.params.id as string));
  },

  /** Called after the reviewed recipe was saved through the normal Recipe Master workflow. */
  async markSaved(req: Request, res: Response): Promise<void> {
    const { recipeId } = req.body as { recipeId: string };
    ok(res, await youtubeImportService.markSaved(req.params.id as string, recipeId));
  },

  async remove(req: Request, res: Response): Promise<void> {
    await youtubeImportService.remove(req.params.id as string);
    noContent(res);
  },
};
