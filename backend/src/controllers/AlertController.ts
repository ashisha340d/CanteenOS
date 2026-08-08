import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { AlertSoundSlot, AlertType, UpdateAlertSettingRequest } from '@menuboard/shared';
import { alertService } from '../services/AlertService';
import { alertRepository } from '../repositories/AlertRepository';
import { getPool } from '../db/pool';
import { requireAuth } from '../middleware/types';
import { NotFoundError, ValidationError } from '../utils/errors';
import { ok } from '../utils/http';
import { mimeTypeForStoragePath, resolveMediaPath } from '../utils/mediaStorage';
import { actorFrom } from './context';

export const AlertController = {
  async listSettings(_req: Request, res: Response): Promise<void> {
    ok(res, await alertService.listSettings());
  },

  async listSounds(_req: Request, res: Response): Promise<void> {
    ok(res, await alertService.listSounds());
  },

  async uploadSound(req: Request, res: Response): Promise<void> {
    if (req.file === undefined) {
      throw new ValidationError('No file was uploaded', [
        { path: 'file', message: 'Attach an audio file under the "file" field' },
      ]);
    }
    ok(
      res,
      await alertService.setSound(
        req.params.slot as AlertSoundSlot,
        {
          tempPath: req.file.path,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
        },
        actorFrom(req),
      ),
    );
  },

  /** The buzzer bytes themselves — any authenticated client, same reasoning as `/sounds`. */
  async downloadSound(req: Request, res: Response): Promise<void> {
    const slot = req.params.slot as AlertSoundSlot;
    const row = await alertRepository.findSound(getPool(), slot);
    if (row === null || row.storage_path === null) {
      throw new NotFoundError('Alert sound', slot);
    }

    const absolutePath = resolveMediaPath(row.storage_path);
    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundError('Alert sound file', slot);
    }

    res.setHeader('Content-Type', mimeTypeForStoragePath(row.storage_path));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(row.file_name ?? slot)}"`,
    );
    fs.createReadStream(absolutePath).pipe(res);
  },

  async updateSetting(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await alertService.updateSetting(
        req.params.alertType as AlertType,
        req.body as UpdateAlertSettingRequest,
        actorFrom(req),
      ),
    );
  },

  /**
   * Alarms the calling device should schedule locally. Scoped to the caller, because which
   * alarms apply depends on their role and which boards they are on.
   */
  async listPending(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const { horizonHours } = req.query as unknown as { horizonHours?: number };
    ok(
      res,
      await alertService.listPendingForUser(auth.userId, auth.role, {
        ...(horizonHours !== undefined ? { horizonHours } : {}),
      }),
    );
  },
};
