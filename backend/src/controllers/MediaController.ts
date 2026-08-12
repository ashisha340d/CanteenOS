import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { MediaAssetUpdateRequest, MediaAssignmentWriteRequest, MediaEntityType } from '@menuboard/shared';
import { mediaService } from '../services/MediaService';
import { requireAuth } from '../middleware/types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { created, noContent, ok, paginated } from '../utils/http';
import { verifyMediaSignature } from '../utils/mediaStorage';
import { mediaAssetRepository } from '../repositories/MediaRepository';
import { getPool } from '../db/pool';
import { resolveMediaPath } from '../utils/mediaStorage';
import { actorFrom } from './context';

/**
 * The Menu Master media library — reusable image assets plus polymorphic assignments. Same
 * signed-URL download pattern as attachments (see AttachmentController.download), because the
 * MediaPicker's `<img>` grid cannot attach a bearer header, and because the underlying assets
 * are otherwise identical in access model to attachments.
 */
export const MediaController = {
  async list(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    paginated(
      res,
      await mediaService.list(
        req.query as unknown as { search?: string; unassignedOnly?: boolean; page?: number; pageSize?: number },
        auth.userId,
      ),
    );
  },

  async getById(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    ok(res, await mediaService.getById(req.params.id as string, auth.userId));
  },

  async upload(req: Request, res: Response): Promise<void> {
    if (req.file === undefined) {
      throw new ValidationError('No file was uploaded', [
        { path: 'file', message: 'Attach a file under the "file" field' },
      ]);
    }
    const query = req.query as unknown as {
      title?: string;
      altText?: string;
      width?: number;
      height?: number;
    };
    const result = await mediaService.upload(
      {
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        width: query.width ?? null,
        height: query.height ?? null,
        title: query.title ?? null,
        altText: query.altText ?? null,
      },
      actorFrom(req),
    );
    created(res, result);
  },

  async update(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await mediaService.update(
        req.params.id as string,
        req.body as MediaAssetUpdateRequest,
        actorFrom(req),
      ),
    );
  },

  async remove(req: Request, res: Response): Promise<void> {
    await mediaService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  /** Serves the bytes, authorised by a signed query string — same as attachments. */
  async download(req: Request, res: Response): Promise<void> {
    const mediaId = req.params.id as string;
    const query = req.query as unknown as { expires: string; uid: string; sig: string };

    const valid = verifyMediaSignature({
      attachmentId: mediaId,
      userId: query.uid,
      expires: query.expires,
      signature: query.sig,
    });
    if (!valid) throw new ForbiddenError('This media link is invalid or has expired');

    const asset = await mediaAssetRepository.findById(getPool(), mediaId);
    if (asset === null) throw new NotFoundError('Media asset', mediaId);

    const absolutePath = resolveMediaPath(asset.storage_path);
    if (!fs.existsSync(absolutePath)) throw new NotFoundError('Media file', mediaId);

    res.setHeader('Content-Type', asset.mime_type);
    res.setHeader('Content-Length', String(asset.size_bytes));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(asset.file_name)}"`);
    fs.createReadStream(absolutePath).pipe(res);
  },

  /* ------------------------------------------------------------------------ assignments */

  async listForEntity(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const { entityType, entityId } = req.query as unknown as {
      entityType: MediaEntityType;
      entityId: string;
    };
    ok(res, await mediaService.listForEntity(entityType, entityId, auth.userId));
  },

  async assign(req: Request, res: Response): Promise<void> {
    created(res, await mediaService.assign(req.body as MediaAssignmentWriteRequest, actorFrom(req)));
  },

  async unassign(req: Request, res: Response): Promise<void> {
    await mediaService.unassign(req.params.id as string, actorFrom(req));
    noContent(res);
  },

  async setPrimary(req: Request, res: Response): Promise<void> {
    ok(res, await mediaService.setPrimary(req.params.id as string, actorFrom(req)));
  },

  async reorder(req: Request, res: Response): Promise<void> {
    const { sortOrder } = req.body as { sortOrder: number };
    await mediaService.reorder(req.params.id as string, sortOrder, actorFrom(req));
    noContent(res);
  },
};
