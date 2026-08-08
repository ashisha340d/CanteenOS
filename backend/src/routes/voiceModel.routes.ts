import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/types';
import { voiceModelService } from '../services/VoiceModelService';
import { ForbiddenError } from '../utils/errors';
import { ok } from '../utils/http';

const downloadQuerySchema = z
  .object({
    expires: z.string().regex(/^\d+$/),
    uid: z.string().uuid(),
    v: z.string().max(40).optional(),
    sig: z.string().min(16).max(200),
  })
  .strict();

/** Authenticated: tells the device what to download and what it must hash to. */
export function voiceModelRoutes(): Router {
  const router = Router();

  router.get(
    '/manifest',
    asyncHandler(async (req, res) => {
      const auth = requireAuth(req);
      ok(res, await voiceModelService.getManifest(auth.userId));
    }),
  );

  return router;
}

/**
 * The bytes themselves, mounted outside the authenticated router.
 *
 * A long-running background download cannot reliably carry a bearer token that may expire
 * mid-transfer, so authorisation comes from the signed, expiring query string instead — the
 * same approach the media download route takes.
 *
 * `Range` is honoured because a 148 MB file over a patchy connection will be interrupted,
 * and making the client start again from zero each time is not a real feature.
 */
export function publicVoiceModelRoutes(): Router {
  const router = Router();

  router.get(
    '/download',
    validate({ query: downloadQuerySchema }),
    asyncHandler(async (req, res) => {
      const query = req.query as unknown as z.infer<typeof downloadQuerySchema>;

      if (
        !voiceModelService.verifySignature({
          userId: query.uid,
          expires: query.expires,
          signature: query.sig,
        })
      ) {
        throw new ForbiddenError('This download link has expired. Open Voice Order again.');
      }

      const rangeHeader = req.headers.range;
      const { sizeBytes } = await voiceModelService.openModelStream();

      // "bytes=START-" and "bytes=START-END". Anything else is ignored and the whole file
      // is sent, which is always a valid response to a Range request.
      const match =
        typeof rangeHeader === 'string' ? rangeHeader.match(/^bytes=(\d+)-(\d*)$/) : null;

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      // The file is immutable for a given version, so a client may cache it indefinitely.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');

      if (match === null) {
        const { stream } = await voiceModelService.openModelStream();
        res.setHeader('Content-Length', String(sizeBytes));
        stream.pipe(res);
        return;
      }

      const start = Number(match[1]);
      const end = match[2] === '' ? sizeBytes - 1 : Number(match[2]);

      if (start >= sizeBytes || end >= sizeBytes || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${sizeBytes}`);
        res.end();
        return;
      }

      const { stream } = await voiceModelService.openModelStream({ start, end });
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${sizeBytes}`);
      res.setHeader('Content-Length', String(end - start + 1));
      stream.pipe(res);
    }),
  );

  return router;
}
