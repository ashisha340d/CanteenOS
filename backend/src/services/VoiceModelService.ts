import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ReadStream } from 'node:fs';
import type { VoiceModelManifestDto } from '@menuboard/shared';
import { config } from '../config';
import { NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

/**
 * Distribution of the offline speech model.
 *
 * The app ships without the Whisper weights — they are ~148 MB, which is more than the APK
 * should carry and more than every user needs. Instead the model is stored server-side and
 * pulled once, after login, over a signed URL.
 *
 * Two properties matter and are both enforced here:
 *
 *   * **Integrity.** The manifest states a SHA-256 the device must verify before activating
 *     the file. A truncated or tampered model would fail in ways that look like bad
 *     transcription rather than a bad download, so the check is not optional on the client.
 *   * **Authorisation.** The bytes sit behind a time-limited signature bound to the
 *     requesting user, the same scheme the media routes use, because a plain `<a download>`
 *     cannot carry a bearer token.
 *
 * The checksum is computed once from the file on disk and cached: hashing 148 MB on every
 * manifest request would be a trivial denial-of-service.
 */

/** Cached so the file is hashed once per process rather than once per request. */
interface CachedManifest {
  version: string;
  sizeBytes: number;
  sha256: string;
  mtimeMs: number;
}

let cached: CachedManifest | null = null;

function modelPath(): string {
  return path.resolve(config.voiceModel.directory, config.voiceModel.fileName);
}

async function sha256OfFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export class VoiceModelService {
  /**
   * What the device needs to decide whether to download, and how to verify what it gets.
   *
   * `version` is the operator-declared identity of the weights. Bumping it in configuration
   * is what tells installed clients a replacement is available — the checksum alone cannot
   * serve that purpose, because a device must be able to compare versions *before*
   * downloading 148 MB to discover the hash differs.
   */
  async getManifest(userId: string): Promise<VoiceModelManifestDto> {
    const filePath = modelPath();
    if (!existsSync(filePath)) {
      throw new NotFoundError('Voice model', config.voiceModel.fileName);
    }

    const stat = await fs.stat(filePath);
    if (cached === null || cached.mtimeMs !== stat.mtimeMs) {
      const startedAt = Date.now();
      const sha256 = await sha256OfFile(filePath);
      cached = {
        version: config.voiceModel.version,
        sizeBytes: stat.size,
        sha256,
        mtimeMs: stat.mtimeMs,
      };
      logger.info('Voice model checksummed', {
        file: config.voiceModel.fileName,
        sizeBytes: stat.size,
        durationMs: Date.now() - startedAt,
      });
    }

    return {
      version: cached.version,
      model: config.voiceModel.modelName,
      /** Multilingual, so Hindi, English and the mixture of the two all work. */
      multilingual: true,
      sizeBytes: cached.sizeBytes,
      sha256: cached.sha256,
      downloadUrl: this.signDownloadUrl(userId),
      expiresInSeconds: config.voiceModel.urlTtlMinutes * 60,
    };
  }

  /** Opens the bytes for streaming, after the signature has already been verified. */
  async openModelStream(range?: { start: number; end?: number }): Promise<{
    stream: ReadStream;
    sizeBytes: number;
  }> {
    const filePath = modelPath();
    if (!existsSync(filePath)) {
      throw new NotFoundError('Voice model', config.voiceModel.fileName);
    }
    const stat = await fs.stat(filePath);
    const stream =
      range === undefined
        ? createReadStream(filePath)
        : createReadStream(filePath, {
            start: range.start,
            ...(range.end !== undefined ? { end: range.end } : {}),
          });
    return { stream, sizeBytes: stat.size };
  }

  signDownloadUrl(userId: string): string {
    const expiresAt = Math.floor(Date.now() / 1000) + config.voiceModel.urlTtlMinutes * 60;
    const query = new URLSearchParams({
      expires: String(expiresAt),
      uid: userId,
      v: config.voiceModel.version,
      sig: this.signature(userId, expiresAt),
    });
    return `${config.publicUrl}/api/v1/voice-model/download?${query.toString()}`;
  }

  verifySignature(input: {
    userId: string;
    expires: string;
    signature: string;
  }): boolean {
    const expiresAt = Number.parseInt(input.expires, 10);
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

    const provided = Buffer.from(input.signature);
    const computed = Buffer.from(this.signature(input.userId, expiresAt));
    // Lengths must match before timingSafeEqual, which throws on mismatched buffers.
    if (provided.length !== computed.length) return false;
    return timingSafeEqual(provided, computed);
  }

  private signature(userId: string, expiresAt: number): string {
    return createHmac('sha256', config.auth.jwtSecret)
      .update(`voice-model:${userId}:${expiresAt}`)
      .digest('base64url');
  }
}

export const voiceModelService = new VoiceModelService();
