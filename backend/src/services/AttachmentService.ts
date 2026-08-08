import {
  AttachmentOwnerType,
  Capability,
  LIMITS,
  MEDIA,
  type AttachmentDto,
  type AttachmentUploadResult,
  type UserRole,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapAttachment } from '../models/mappers';
import { attachmentRepository } from '../repositories/AttachmentRepository';
import { boardRepository } from '../repositories/BoardRepository';
import { orderRepository } from '../repositories/OrderRepository';
import { threadRepository } from '../repositories/ThreadRepository';
import { realtime } from '../realtime/RealtimeGateway';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { newId } from '../utils/ids';
import { logger } from '../utils/logger';
import {
  deleteStoredFile,
  kindForMimeType,
  maxBytesForKind,
  resolveMediaPath,
  signMediaUrl,
  storeUploadedFile,
} from '../utils/mediaStorage';
import { AuditAction, auditService, type AuditActor } from './AuditService';
import { permissionsCacheService } from './PermissionsCacheService';

export interface UploadInput {
  /** Client-supplied id, so the device can reference the attachment before the upload lands. */
  attachmentId?: string;
  ownerType: AttachmentOwnerType;
  /** Optional: media is often captured before the order exists. */
  ownerId?: string | null;
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * Attachment lifecycle.
 *
 * Media and its owner arrive independently: a device captures a photo or voice note before the
 * order is pushed, so an attachment may be created with a null owner and bound later. Unbound
 * rows are visible only to their uploader and are swept if they are never claimed.
 */
export class AttachmentService {
  async upload(input: UploadInput, actor: AuditActor): Promise<AttachmentUploadResult> {
    if (actor.userId === null) throw new ForbiddenError();
    const uploaderId = actor.userId;

    await this.assertMayUpload(uploaderId, actor.role);

    const kind = kindForMimeType(input.mimeType);
    const maxBytes = maxBytesForKind(kind);
    if (input.sizeBytes > maxBytes) {
      await deleteStoredFile(input.tempPath).catch(() => undefined);
      throw new ValidationError('The file is too large', [
        {
          path: 'file',
          message: `${kind} uploads are limited to ${Math.floor(maxBytes / (1024 * 1024))} MB`,
        },
      ]);
    }

    if (
      kind === 'VOICE_NOTE' &&
      input.durationMs !== undefined &&
      input.durationMs !== null &&
      input.durationMs > MEDIA.VOICE_NOTE_MAX_DURATION_MS
    ) {
      throw new ValidationError('The voice note is too long', [
        {
          path: 'durationMs',
          message: `Voice notes are limited to ${MEDIA.VOICE_NOTE_MAX_DURATION_MS / 60000} minutes`,
        },
      ]);
    }

    const attachmentId = input.attachmentId ?? newId();

    if (input.ownerId) {
      await this.assertOwnerWritable(getPool(), input.ownerType, input.ownerId, uploaderId);
      const existingCount = await attachmentRepository.countForOwner(
        getPool(),
        input.ownerType,
        input.ownerId,
      );
      if (existingCount >= LIMITS.ATTACHMENTS_PER_OWNER_MAX) {
        throw new ConflictError(
          `This item already has the maximum of ${LIMITS.ATTACHMENTS_PER_OWNER_MAX} attachments`,
        );
      }
    }

    const stored = await storeUploadedFile({
      attachmentId,
      tempPath: input.tempPath,
      mimeType: input.mimeType,
      kind,
    });

    try {
      const row = await withTransaction(async (connection) => {
        let created;
        try {
          created = await attachmentRepository.insert(connection, {
            id: attachmentId,
            ownerType: input.ownerType,
            ownerId: input.ownerId ?? null,
            kind,
            fileName: sanitiseFileName(input.originalName),
            storagePath: stored.storagePath,
            mimeType: input.mimeType,
            sizeBytes: stored.sizeBytes,
            durationMs: input.durationMs ?? null,
            width: input.width ?? null,
            height: input.height ?? null,
            checksum: stored.checksum,
            uploadedBy: uploaderId,
          });
        } catch (error) {
          // A retried upload after a crash between the bytes landing and the client learning
          // about it replays the same client-supplied attachmentId. Treat a duplicate-key
          // collision on that id as the same upload succeeding again, rather than a 500 —
          // provided the retried bytes genuinely match what is already stored. A checksum
          // mismatch on the same id is not a retry; it is a genuine (and very unlikely) client
          // bug or id collision, and must still fail loudly.
          if (!isDuplicateKeyError(error)) throw error;

          const existing = await attachmentRepository.findById(connection, attachmentId);
          if (existing === null || existing.checksum !== stored.checksum) throw error;

          // The bytes were re-stored (possibly at a different dated path than the original
          // successful upload) before this duplicate-key collision surfaced; the existing row
          // is the source of truth, so an unreferenced re-store of identical bytes is cleaned
          // up rather than left as an orphaned file.
          if (existing.storage_path !== stored.storagePath) {
            await deleteStoredFile(stored.storagePath);
          }

          return existing;
        }

        await auditService.record(connection, actor, {
          action: AuditAction.ATTACHMENT_UPLOADED,
          entityType: 'attachment',
          entityId: created.id,
          after: {
            kind,
            ownerType: input.ownerType,
            ownerId: input.ownerId ?? null,
            sizeBytes: stored.sizeBytes,
          },
        });

        return created;
      });

      if (input.ownerId) await this.announce(input.ownerType, input.ownerId, Number(row.sync_seq));

      return { attachment: mapAttachment(row), url: signMediaUrl(row.id, uploaderId) };
    } catch (error) {
      // The row is the source of truth. If it could not be written, the bytes must not linger.
      await deleteStoredFile(stored.storagePath);
      throw error;
    }
  }

  /** Binds previously uploaded, unowned attachments once their owner exists. */
  async bind(
    attachmentIds: readonly string[],
    ownerType: AttachmentOwnerType,
    ownerId: string,
    actor: AuditActor,
  ): Promise<number> {
    if (actor.userId === null) throw new ForbiddenError();
    if (attachmentIds.length === 0) return 0;

    await this.assertMayUpload(actor.userId, actor.role);

    return withTransaction(async (connection) => {
      await this.assertOwnerWritable(connection, ownerType, ownerId, actor.userId as string);
      return attachmentRepository.bindToOwner(
        connection,
        attachmentIds,
        ownerType,
        ownerId,
        actor.userId as string,
      );
    });
  }

  async getForDownload(
    attachmentId: string,
    userId: string,
  ): Promise<{ attachment: AttachmentDto; absolutePath: string }> {
    const pool = getPool();
    const row = await attachmentRepository.findById(pool, attachmentId);
    if (row === null) throw new NotFoundError('Attachment', attachmentId);

    await this.assertReadable(pool, row.owner_type, row.owner_id, row.uploaded_by, userId);

    return {
      attachment: mapAttachment(row),
      absolutePath: resolveMediaPath(row.storage_path),
    };
  }

  async signedUrl(attachmentId: string, userId: string): Promise<string> {
    // Access is verified before a URL is minted, so the signature never grants more than the
    // caller already had.
    await this.getForDownload(attachmentId, userId);
    return signMediaUrl(attachmentId, userId);
  }

  async remove(attachmentId: string, actor: AuditActor): Promise<void> {
    if (actor.userId === null) throw new ForbiddenError();
    const actorId = actor.userId;

    const result = await withTransaction(async (connection) => {
      const row = await attachmentRepository.findById(connection, attachmentId);
      if (row === null) throw new NotFoundError('Attachment', attachmentId);

      // Deleting someone else's media requires ATTACHMENT_DELETE_ANY, granted either globally
      // (SUPER_ADMIN/ADMIN) or by board role (currently OWNER only — see BOARD_ROLE_CAPABILITIES,
      // the single source of truth) — the uploader may always remove their own regardless.
      if (row.uploaded_by !== actorId) {
        await this.assertMayDeleteAny(connection, row.owner_type, row.owner_id, actorId, actor.role);
      }

      await attachmentRepository.softDelete(connection, attachmentId);

      await auditService.record(connection, actor, {
        action: AuditAction.ATTACHMENT_DELETED,
        entityType: 'attachment',
        entityId: attachmentId,
        before: { kind: row.kind, ownerType: row.owner_type, ownerId: row.owner_id },
      });

      return row;
    });

    if (result.owner_id !== null) {
      await this.announce(result.owner_type, result.owner_id, 0);
    }
  }

  /**
   * Reclaims files whose rows were never bound to an owner. Runs on a schedule rather than
   * inline, so a slow filesystem never delays a request.
   */
  async sweepOrphans(olderThanHours = 48, limit = 200): Promise<number> {
    const pool = getPool();
    const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
    const orphans = await attachmentRepository.findOrphans(pool, cutoff, limit);

    let removed = 0;
    for (const orphan of orphans) {
      await deleteStoredFile(orphan.storage_path);
      await attachmentRepository.hardDelete(pool, orphan.id);
      removed += 1;
    }

    if (removed > 0) logger.info('Swept orphaned attachments', { removed });
    return removed;
  }

  /* ------------------------------------------------------------- internals */

  /**
   * ATTACHMENT_UPLOAD is a board-level capability, never a global one for MANAGER or USER, so it
   * cannot be checked by route middleware — a plain member holds it only through membership.
   *
   * An upload with an owner is fully checked by `assertOwnerWritable`. An upload without one has
   * no board to check yet, so the requirement is that the caller could attach the file *somewhere*:
   * membership of at least one board in a non-viewer role. Without that, any authenticated account
   * could fill the media store with files it could never use.
   */
  private async assertMayUpload(userId: string, role: UserRole | null): Promise<void> {
    if (role !== null && permissionsCacheService.roleHasCapability(role, Capability.ATTACHMENT_UPLOAD)) {
      return;
    }

    const boardRoles = await boardRepository.listActiveRolesForUser(getPool(), userId);
    const canUploadSomewhere = boardRoles.some((boardRole) =>
      permissionsCacheService.boardRoleHasCapability(boardRole, Capability.ATTACHMENT_UPLOAD),
    );

    if (!canUploadSomewhere) {
      throw new ForbiddenError('You do not have permission to upload files');
    }
  }

  private async assertOwnerWritable(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string | null,
    userId: string,
  ): Promise<void> {
    if (ownerId === null) return;

    const boardId = await this.resolveBoardId(db, ownerType, ownerId);
    if (boardId === null) throw new NotFoundError('Attachment owner', ownerId);

    const boardRole = await boardRepository.findActiveRole(db, boardId, userId);
    if (boardRole === null || boardRole === 'VIEWER') {
      throw new ForbiddenError('You cannot attach files to this board');
    }
  }

  /**
   * ATTACHMENT_DELETE_ANY is required to remove another user's attachment — granted globally to
   * admin-tier roles (SUPER_ADMIN/ADMIN), or per-board to OWNER. A plain MEMBER or MANAGER (who
   * only hold ATTACHMENT_UPLOAD at board level) must not be able to delete someone else's media
   * just by being a member — see `BOARD_ROLE_CAPABILITIES` in shared/src/permissions.
   */
  private async assertMayDeleteAny(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string | null,
    userId: string,
    role: UserRole | null,
  ): Promise<void> {
    if (role !== null && permissionsCacheService.roleHasCapability(role, Capability.ATTACHMENT_DELETE_ANY)) {
      return;
    }

    if (ownerId === null) {
      // Unbound attachments have no board to derive a board-level capability from, and the
      // uploader-owns-it path above already returns early for the uploader themselves.
      throw new ForbiddenError('You do not have permission to delete this attachment');
    }

    const boardId = await this.resolveBoardId(db, ownerType, ownerId);
    if (boardId === null) throw new NotFoundError('Attachment owner', ownerId);

    const boardRole = await boardRepository.findActiveRole(db, boardId, userId);
    if (
      boardRole === null ||
      !permissionsCacheService.boardRoleHasCapability(boardRole, Capability.ATTACHMENT_DELETE_ANY)
    ) {
      throw new ForbiddenError('You do not have permission to delete this attachment');
    }
  }

  private async assertReadable(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string | null,
    uploadedBy: string,
    userId: string,
  ): Promise<void> {
    // An unbound attachment is private to whoever uploaded it.
    if (ownerId === null) {
      if (uploadedBy !== userId) throw new ForbiddenError();
      return;
    }

    const boardId = await this.resolveBoardId(db, ownerType, ownerId);
    if (boardId === null) throw new NotFoundError('Attachment owner', ownerId);

    const boardRole = await boardRepository.findActiveRole(db, boardId, userId);
    if (boardRole === null) throw new ForbiddenError('You are not a member of this board');
  }

  private async resolveBoardId(
    db: Db,
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ): Promise<string | null> {
    if (ownerType === AttachmentOwnerType.ORDER) {
      const order = await orderRepository.findById(db, ownerId);
      return order === null ? null : order.board_id;
    }

    const message = await threadRepository.findById(db, ownerId);
    return message === null ? null : message.board_id;
  }

  private async announce(
    ownerType: AttachmentOwnerType,
    ownerId: string,
    cursor: number,
  ): Promise<void> {
    const boardId = await this.resolveBoardId(getPool(), ownerType, ownerId);
    if (boardId !== null) realtime.emitBoardChange(boardId, ['attachments'], cursor);
  }
}

/** True for a MySQL/MariaDB unique-constraint violation (errno 1062 / `ER_DUP_ENTRY`). */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ('code' in error && (error as { code?: unknown }).code === 'ER_DUP_ENTRY')
  );
}

/** Keeps a display name without letting it influence anything on disk. */
function sanitiseFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
}

export const attachmentService = new AttachmentService();
