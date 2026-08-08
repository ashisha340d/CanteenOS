import fs from 'node:fs';
import type { Request, Response } from 'express';
import type { AttachmentOwnerType } from '@menuboard/shared';
import { attachmentService } from '../services/AttachmentService';
import { requireAuth } from '../middleware/types';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { created, noContent, ok } from '../utils/http';
import { verifyMediaSignature } from '../utils/mediaStorage';
import { actorFrom } from './context';

interface UploadQuery {
  attachmentId?: string;
  ownerType: AttachmentOwnerType;
  ownerId?: string;
  durationMs?: number;
  width?: number;
  height?: number;
}

export const AttachmentController = {
  async upload(req: Request, res: Response): Promise<void> {
    if (req.file === undefined) {
      throw new ValidationError('No file was uploaded', [
        { path: 'file', message: 'Attach a file under the "file" field' },
      ]);
    }

    const query = req.query as unknown as UploadQuery;
    const result = await attachmentService.upload(
      {
        ...(query.attachmentId !== undefined ? { attachmentId: query.attachmentId } : {}),
        ownerType: query.ownerType,
        ownerId: query.ownerId ?? null,
        tempPath: req.file.path,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        durationMs: query.durationMs ?? null,
        width: query.width ?? null,
        height: query.height ?? null,
      },
      actorFrom(req),
    );

    created(res, result);
  },

  async bind(req: Request, res: Response): Promise<void> {
    const input = req.body as {
      attachmentIds: string[];
      ownerType: AttachmentOwnerType;
      ownerId: string;
    };
    const bound = await attachmentService.bind(
      input.attachmentIds,
      input.ownerType,
      input.ownerId,
      actorFrom(req),
    );
    ok(res, { bound });
  },

  /** Returns a fresh signed URL for a client that needs to (re)download the bytes. */
  async getUrl(req: Request, res: Response): Promise<void> {
    const auth = requireAuth(req);
    const url = await attachmentService.signedUrl(req.params.id as string, auth.userId);
    ok(res, { url });
  },

  /**
   * Serves the bytes. Authorised by the signed query string rather than a bearer token, so an
   * `<Image>` or audio element can fetch it directly; the signature is bound to the attachment,
   * the user and an expiry.
   */
  async download(req: Request, res: Response): Promise<void> {
    const attachmentId = req.params.id as string;
    const query = req.query as unknown as { expires: string; uid: string; sig: string };

    const valid = verifyMediaSignature({
      attachmentId,
      userId: query.uid,
      expires: query.expires,
      signature: query.sig,
    });
    if (!valid) {
      throw new ForbiddenError('This media link is invalid or has expired');
    }

    // Signature integrity is not authorisation on its own: board membership may have changed
    // since the link was issued, so access is re-checked.
    const { attachment, absolutePath } = await attachmentService.getForDownload(
      attachmentId,
      query.uid,
    );

    if (!fs.existsSync(absolutePath)) {
      throw new NotFoundError('Attachment file', attachmentId);
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Length', String(attachment.sizeBytes));
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.fileName)}"`,
    );
    // Streamed rather than buffered so a large voice note does not sit in memory.
    fs.createReadStream(absolutePath).pipe(res);
  },

  async remove(req: Request, res: Response): Promise<void> {
    await attachmentService.remove(req.params.id as string, actorFrom(req));
    noContent(res);
  },
};
