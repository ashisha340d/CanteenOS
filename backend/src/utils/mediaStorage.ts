import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AttachmentKind, MEDIA } from '@menuboard/shared';
import { config } from '../config';
import { logger } from '../utils/logger';
import { UnsupportedMediaTypeError, ValidationError } from './errors';

/**
 * Local filesystem media store.
 *
 * Files are laid out as `<kind>/<YYYY>/<MM>/<id><ext>`. The date folders keep any single
 * directory small enough to stay fast, and the id (not the client's filename) is the stored
 * name, so a hostile filename cannot influence the path.
 */

export interface StoredFile {
  /** Relative path, always POSIX-separated. This is what goes in the database. */
  storagePath: string;
  absolutePath: string;
  sizeBytes: number;
  checksum: string;
}

export async function ensureMediaDirectories(): Promise<void> {
  await fs.mkdir(config.media.root, { recursive: true });
  await fs.mkdir(config.media.tmp, { recursive: true });
}

export function kindForMimeType(mimeType: string): AttachmentKind {
  if ((MEDIA.IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return AttachmentKind.IMAGE;
  }
  if ((MEDIA.AUDIO_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return AttachmentKind.VOICE_NOTE;
  }
  if ((MEDIA.DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return AttachmentKind.DOCUMENT;
  }
  throw new UnsupportedMediaTypeError(`Files of type ${mimeType} are not accepted`);
}

export function maxBytesForKind(kind: AttachmentKind): number {
  switch (kind) {
    case AttachmentKind.IMAGE:
      return MEDIA.IMAGE_MAX_BYTES;
    case AttachmentKind.VOICE_NOTE:
      return MEDIA.AUDIO_MAX_BYTES;
    case AttachmentKind.DOCUMENT:
      return MEDIA.DOCUMENT_MAX_BYTES;
    default:
      return MEDIA.IMAGE_MAX_BYTES;
  }
}

/** Whitelist of extensions per MIME type; the client's extension is never trusted. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'audio/m4a': '.m4a',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/mpeg': '.mp3',
  'audio/webm': '.webm',
  'application/pdf': '.pdf',
};

export function extensionForMimeType(mimeType: string): string {
  const extension = EXTENSION_BY_MIME[mimeType];
  if (extension === undefined) {
    throw new UnsupportedMediaTypeError(`Files of type ${mimeType} are not accepted`);
  }
  return extension;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm',
  '.pdf': 'application/pdf',
};

/** Used for bytes served without an owning `attachments` row, which carries its own MIME. */
export function mimeTypeForStoragePath(storagePath: string): string {
  const extension = path.extname(storagePath).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/** Moves an uploaded temp file into its permanent location and hashes it. */
export async function storeUploadedFile(input: {
  attachmentId: string;
  tempPath: string;
  mimeType: string;
  kind: AttachmentKind;
}): Promise<StoredFile> {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  const relativeDir = path.posix.join(input.kind.toLowerCase(), year, month);
  const fileName = `${input.attachmentId}${extensionForMimeType(input.mimeType)}`;
  const storagePath = path.posix.join(relativeDir, fileName);

  const absoluteDir = path.join(config.media.root, relativeDir);
  const absolutePath = path.join(absoluteDir, fileName);

  await fs.mkdir(absoluteDir, { recursive: true });

  const buffer = await fs.readFile(input.tempPath);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  await fs.writeFile(absolutePath, buffer);

  // Best-effort cleanup: the file is already safely stored, so a failure here is not fatal.
  await fs.rm(input.tempPath, { force: true }).catch((error: unknown) => {
    logger.warn('Failed to remove upload temp file', { tempPath: input.tempPath }, error);
  });

  return { storagePath, absolutePath, sizeBytes: buffer.byteLength, checksum };
}

/**
 * Resolves a stored relative path to an absolute one, refusing anything that escapes the media
 * root. Guards against a database value that was tampered with or written by an older bug.
 */
export function resolveMediaPath(storagePath: string): string {
  const normalised = path.normalize(storagePath).replace(/^([/\\])+/, '');
  const absolute = path.resolve(config.media.root, normalised);
  const root = path.resolve(config.media.root);

  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new ValidationError('Invalid media path');
  }
  return absolute;
}

export async function deleteStoredFile(storagePath: string): Promise<void> {
  try {
    await fs.rm(resolveMediaPath(storagePath), { force: true });
  } catch (error) {
    // The database tombstone is the source of truth; a stranded file is reclaimed later.
    logger.warn('Failed to delete stored media file', { storagePath }, error);
  }
}

/* ------------------------------------------------------------ signed media URLs */

/**
 * Time-limited signed URL. The signature covers the attachment id, the authorised user and the
 * expiry, so a URL cannot be edited to reach a different file, cannot be shared with another
 * account, and stops working on its own.
 */
export function signMediaUrl(attachmentId: string, userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + config.media.urlTtlMinutes * 60;
  const signature = mediaSignature(attachmentId, userId, expiresAt);
  const query = new URLSearchParams({
    expires: String(expiresAt),
    uid: userId,
    sig: signature,
  });
  return `${config.publicUrl}/api/v1/attachments/${attachmentId}/file?${query.toString()}`;
}

/**
 * Same signed-URL scheme as {@link signMediaUrl}, for the Menu Master media library
 * (`media_assets`) rather than order/thread `attachments`. Kept as a separate function because
 * the two tables have separate ownership/visibility rules even though the signature mechanics
 * are identical — a menu media asset has no board membership to re-check on download.
 */
export function signMenuMediaUrl(mediaId: string, userId: string): string {
  const expiresAt = Math.floor(Date.now() / 1000) + config.media.urlTtlMinutes * 60;
  const signature = mediaSignature(mediaId, userId, expiresAt);
  const query = new URLSearchParams({
    expires: String(expiresAt),
    uid: userId,
    sig: signature,
  });
  return `${config.publicUrl}/api/v1/media/${mediaId}/file?${query.toString()}`;
}

export function verifyMediaSignature(input: {
  attachmentId: string;
  userId: string;
  expires: string;
  signature: string;
}): boolean {
  const expiresAt = Number.parseInt(input.expires, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  const expected = mediaSignature(input.attachmentId, input.userId, expiresAt);
  const provided = Buffer.from(input.signature);
  const computed = Buffer.from(expected);

  // Length must match before timingSafeEqual, which throws on mismatched buffers.
  if (provided.length !== computed.length) return false;
  return timingSafeEqual(provided, computed);
}

function mediaSignature(attachmentId: string, userId: string, expiresAt: number): string {
  return createHmac('sha256', config.auth.jwtSecret)
    .update(`${attachmentId}:${userId}:${expiresAt}`)
    .digest('base64url');
}
