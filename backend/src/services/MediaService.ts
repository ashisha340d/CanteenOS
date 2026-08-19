import path from 'node:path';
import {
  MEDIA,
  MediaRole,
  MediaType,
  type MediaAssetDto,
  type MediaAssignmentDto,
  type MediaAssignmentWriteRequest,
  type MediaAssetUpdateRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapMediaAsset, mapMediaAssignment } from '../models/mappers';
import { mediaAssetRepository, mediaAssignmentRepository } from '../repositories/MediaRepository';
import { menuBoardRealtime } from '../realtime/menuBoardSocket';
import { AttachmentKind } from '@menuboard/shared';
import { ConflictError, NotFoundError, UnsupportedMediaTypeError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import {
  deleteStoredFile,
  storeUploadedFile,
} from '../utils/mediaStorage';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface MediaUploadInput {
  tempPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  title?: string | null;
  altText?: string | null;
}

/**
 * The Menu Master media library: reusable assets plus polymorphic assignments to Menu /
 * MenuCategoryAssignment / MenuItemAssignment / MenuItemVariant rows, following the
 * media_library + product_images split proven at mtcstudio's MediaPicker
 * (github.com/ashisha340d/mtcstudio, server/database/db.js + client/.../MediaPicker.jsx),
 * adapted to this project's storage (`utils/mediaStorage.ts`) and UUID/soft-delete/revision
 * conventions.
 *
 * An asset is never deleted while any assignment still references it, and unassigning never
 * deletes the underlying file — only the link.
 */
export class MediaService {
  async list(query: { search?: string; unassignedOnly?: boolean; page?: number; pageSize?: number }, userId: string) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await mediaAssetRepository.list(getPool(), {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.unassignedOnly !== undefined ? { unassignedOnly: query.unassignedOnly } : {}),
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map((row) => mapMediaAsset(row, userId)), total, page, pageSize);
  }

  async getById(id: string, userId: string): Promise<MediaAssetDto> {
    const row = await mediaAssetRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Media asset', id);
    return mapMediaAsset(row, userId);
  }

  /** Menu Master media is images only — dish, category, menu and variant photography. */
  private assertImage(mimeType: string): void {
    if (!(MEDIA.IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new UnsupportedMediaTypeError('Only JPEG, PNG or WebP images are accepted');
    }
  }

  async upload(input: MediaUploadInput, actor: AuditActor): Promise<MediaAssetDto> {
    this.assertImage(input.mimeType);
    if (input.sizeBytes > MEDIA.IMAGE_MAX_BYTES) {
      throw new UnsupportedMediaTypeError(
        `Image exceeds the ${Math.round(MEDIA.IMAGE_MAX_BYTES / (1024 * 1024))} MB limit`,
      );
    }

    const id = newId();
    const stored = await storeUploadedFile({
      attachmentId: id,
      tempPath: input.tempPath,
      mimeType: input.mimeType,
      kind: AttachmentKind.IMAGE,
    });

    const row = await withTransaction(async (connection) => {
      const created = await mediaAssetRepository.insert(connection, {
        id,
        fileName: input.originalName,
        storagePath: stored.storagePath,
        mimeType: input.mimeType,
        fileExtension: path.extname(input.originalName).toLowerCase() || null,
        sizeBytes: stored.sizeBytes,
        width: input.width ?? null,
        height: input.height ?? null,
        mediaType: MediaType.IMAGE,
        title: input.title ?? null,
        altText: input.altText ?? null,
        checksum: stored.checksum,
        createdBy: actor.userId,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.ATTACHMENT_UPLOADED,
        entityType: 'media_asset',
        entityId: created.id,
        after: { fileName: created.file_name },
      });
      return created;
    });

    return mapMediaAsset(row, actor.userId ?? '');
  }

  async update(id: string, input: MediaAssetUpdateRequest, actor: AuditActor): Promise<MediaAssetDto> {
    const row = await withTransaction(async (connection) => {
      const before = await mediaAssetRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Media asset', id);
      const updated = await mediaAssetRepository.update(connection, id, input);
      if (updated === null) throw new NotFoundError('Media asset', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'media_asset',
        entityId: id,
      });
      return updated;
    });
    return mapMediaAsset(row, actor.userId ?? '');
  }

  /** Refused while any assignment still links this asset — unassign everywhere first. */
  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await mediaAssetRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Media asset', id);

      const activeAssignments = await mediaAssetRepository.countActiveAssignments(connection, id);
      if (activeAssignments > 0) {
        throw new ConflictError(
          `This image is still used in ${activeAssignments} place(s); remove those assignments first`,
        );
      }

      await mediaAssetRepository.softDelete(connection, id);
      await deleteStoredFile(before.storage_path);
      await auditService.record(connection, actor, {
        action: AuditAction.ATTACHMENT_DELETED,
        entityType: 'media_asset',
        entityId: id,
      });
    });
  }

  /* ------------------------------------------------------------------------ assignments */

  async listForEntity(entityType: MediaAssignmentDto['entityType'], entityId: string, userId: string) {
    const rows = await mediaAssignmentRepository.listForEntity(getPool(), entityType, entityId);
    return Promise.all(
      rows.map(async (row) => {
        const dto = mapMediaAssignment(row);
        const asset = await mediaAssetRepository.findById(getPool(), row.media_id);
        return { ...dto, ...(asset ? { media: mapMediaAsset(asset, userId) } : {}) };
      }),
    );
  }

  /**
   * Links an existing asset to an entity. If this is the entity's first assignment, or the
   * caller explicitly asks, it becomes primary — clearing any previous primary for that entity
   * so at most one is ever marked. The asset itself is never duplicated.
   */
  async assign(input: MediaAssignmentWriteRequest, actor: AuditActor): Promise<MediaAssignmentDto> {
    const row = await withTransaction(async (connection) => {
      const asset = await mediaAssetRepository.findById(connection, input.mediaId);
      if (asset === null) throw new NotFoundError('Media asset', input.mediaId);

      const existing = await mediaAssignmentRepository.listForEntity(
        connection,
        input.entityType,
        input.entityId,
      );
      const makePrimary = input.isPrimary ?? existing.length === 0;

      const created = await mediaAssignmentRepository.insert(connection, {
        id: newId(),
        mediaId: input.mediaId,
        entityType: input.entityType,
        entityId: input.entityId,
        role: input.role ?? MediaRole.GALLERY,
        isPrimary: makePrimary,
        sortOrder: input.sortOrder ?? existing.length,
        createdBy: actor.userId,
      });

      if (makePrimary) {
        await mediaAssignmentRepository.clearPrimaryForEntity(
          connection,
          input.entityType,
          input.entityId,
          created.id,
        );
      }

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'media_assignment',
        entityId: created.id,
        after: { entityType: input.entityType, entityId: input.entityId, mediaId: input.mediaId },
      });
      return created;
    });
    // Every one of these entity types is something a board's resolved menu tree can carry a
    // photo for (see `MenuMasterService.getMenuTree`'s media-inheritance chain); a board that
    // just displayed an item with no photo needs to know the moment one lands on it.
    menuBoardRealtime.announceChange(`media:assign:${input.entityType}`);
    return mapMediaAssignment(row);
  }

  /** Removes the link only — the asset survives for reuse elsewhere. */
  async unassign(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const removed = await mediaAssignmentRepository.softDelete(connection, id);
      if (!removed) throw new NotFoundError('Media assignment', id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'media_assignment',
        entityId: id,
      });
    });
    menuBoardRealtime.announceChange('media:unassign');
  }

  /** Makes this assignment the entity's primary image, demoting any previous one. */
  async setPrimary(id: string, actor: AuditActor): Promise<MediaAssignmentDto> {
    const row = await withTransaction(async (connection) => {
      const assignment = await mediaAssignmentRepository.findById(connection, id);
      if (assignment === null) throw new NotFoundError('Media assignment', id);

      await mediaAssignmentRepository.clearPrimaryForEntity(
        connection,
        assignment.entity_type,
        assignment.entity_id,
      );
      const updated = await mediaAssignmentRepository.setPrimary(connection, id, true);
      if (updated === null) throw new NotFoundError('Media assignment', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'media_assignment',
        entityId: id,
        after: { isPrimary: true },
      });
      return updated;
    });
    menuBoardRealtime.announceChange('media:setPrimary');
    return mapMediaAssignment(row);
  }

  async reorder(id: string, sortOrder: number, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const assignment = await mediaAssignmentRepository.findById(connection, id);
      if (assignment === null) throw new NotFoundError('Media assignment', id);
      await mediaAssignmentRepository.reorder(connection, id, sortOrder);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'media_assignment',
        entityId: id,
        after: { sortOrder },
      });
    });
    menuBoardRealtime.announceChange('media:reorder');
  }
}

export const mediaService = new MediaService();
