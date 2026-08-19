import path from 'node:path';
import multer from 'multer';
import type { Request } from 'express';
import { MEDIA } from '@menuboard/shared';
import { config } from '../config';
import { newId } from '../utils/ids';
import { UnsupportedMediaTypeError } from '../utils/errors';

/**
 * Multer configuration for media uploads.
 *
 * Files land on disk in a temp directory rather than in memory, so a burst of large voice notes
 * cannot exhaust the heap. The service then hashes and moves each file into its permanent
 * location; anything left behind is reclaimed by the orphan sweep.
 */

const ACCEPTED_MIME_TYPES = new Set<string>([
  ...MEDIA.IMAGE_MIME_TYPES,
  ...MEDIA.AUDIO_MIME_TYPES,
  ...MEDIA.DOCUMENT_MIME_TYPES,
]);

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, config.media.tmp);
  },
  filename: (_req, file, callback) => {
    // The client's filename never reaches the filesystem — only a fresh UUID and a whitelisted
    // extension derived from the declared MIME type.
    const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
    callback(null, `${newId()}${extension.replace(/[^.a-z0-9]/g, '')}`);
  },
});

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  callback: multer.FileFilterCallback,
): void {
  if (!ACCEPTED_MIME_TYPES.has(file.mimetype)) {
    callback(new UnsupportedMediaTypeError(`Files of type ${file.mimetype} are not accepted`));
    return;
  }
  callback(null, true);
}

/**
 * A single file per request under the field name `file`.
 *
 * The size ceiling here is the largest any kind allows; the service then enforces the tighter
 * per-kind limit. Multer cannot vary its limit by MIME type, so the coarse guard stops the
 * stream early and the precise one produces the useful message.
 */
export const uploadSingleMedia = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Math.max(MEDIA.IMAGE_MAX_BYTES, MEDIA.AUDIO_MAX_BYTES, MEDIA.DOCUMENT_MAX_BYTES),
    files: 1,
    fields: 20,
  },
}).single('file');

/**
 * The Equipment module's own uploader: images, audio, documents **and video**.
 *
 * A separate instance rather than widening `ACCEPTED_MIME_TYPES` above, so the attachment and
 * Menu Master endpoints keep taking exactly what they took before. A fault is often something
 * you can only show — a noise, a leak, a flame that will not hold — which is why this one
 * accepts a clip; the ceiling is the video limit because multer cannot vary a limit by type,
 * and `EquipmentService.uploadMedia` then enforces the tighter per-kind one.
 */
export const uploadSingleEquipmentMedia = multer({
  storage,
  fileFilter: (_req, file, callback) => {
    const accepted =
      ACCEPTED_MIME_TYPES.has(file.mimetype) ||
      (MEDIA.VIDEO_MIME_TYPES as readonly string[]).includes(file.mimetype);
    if (!accepted) {
      callback(new UnsupportedMediaTypeError(`Files of type ${file.mimetype} are not accepted`));
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: MEDIA.VIDEO_MAX_BYTES, files: 1, fields: 20 },
}).single('file');

/**
 * A single audio file kept in memory rather than written to disk — used by the recipe
 * importer's "record and transcribe" step, which forwards the bytes straight to Gemini and
 * never persists them.
 */
export const uploadSingleAudioInMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, callback) => {
    if (!(MEDIA.AUDIO_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(new UnsupportedMediaTypeError('File must be an audio recording'));
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: MEDIA.AUDIO_MAX_BYTES, files: 1 },
}).single('file');

/**
 * A single audio file for an alarm buzzer (`AlertSoundSlot`). Written to the same temp
 * directory as ordinary media, then moved into permanent storage by `AlertService.setSound`
 * — alert sounds are not owned by an order or thread, so they never touch the `attachments`
 * table, only `alert_sounds`.
 */
export const uploadSingleAlertSound = multer({
  storage,
  fileFilter: (_req, file, callback) => {
    if (!(MEDIA.AUDIO_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(new UnsupportedMediaTypeError('File must be an audio recording'));
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: MEDIA.AUDIO_MAX_BYTES, files: 1 },
}).single('file');
