import {
  EntityType,
  MasterStatus,
  type EntityDto,
  type EntityWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapEntity } from '../models/mappers';
import {
  entityRepository,
  type EntityListFilter,
  type UpdateEntityInput,
} from '../repositories/EntityRepository';
import { userRepository } from '../repositories/UserRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * The Entity master — every party the operation deals with, discriminated by type.
 *
 * Codes are server-allocated per type so that a counter operator never has to invent one and
 * two operators registering simultaneously cannot collide: the sequence is read `FOR UPDATE`
 * inside the same transaction as the insert, and the unique key on `code` is the backstop.
 */

const CODE_PREFIX: Readonly<Record<EntityType, string>> = {
  [EntityType.CUSTOMER]: 'CUS-',
  [EntityType.EMPLOYEE]: 'EMP-',
  [EntityType.VENDOR]: 'VEN-',
  [EntityType.OTHER]: 'OTH-',
};

const CODE_PAD = 4;

export interface EntityQuery {
  search?: string;
  type?: EntityType;
  status?: MasterStatus;
  phone?: string;
  page?: number;
  pageSize?: number;
}

function pagingFor(query: EntityQuery): EntityListFilter & { page: number; pageSize: number } {
  const { page, pageSize, offset } = resolvePaging(query);
  return {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.type !== undefined ? { type: query.type } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    ...(query.phone !== undefined ? { phone: query.phone } : {}),
    limit: pageSize,
    offset,
    page,
    pageSize,
  };
}

export class EntityService {
  async list(query: EntityQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await entityRepository.list(getPool(), filter);
    return buildPage(rows.map(mapEntity), total, filter.page, filter.pageSize);
  }

  async getById(id: string): Promise<EntityDto> {
    const row = await entityRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Entity', id);
    return mapEntity(row);
  }

  /** The counter's "who is this?" lookup. Returns null rather than 404 — a miss is normal. */
  async findByPhone(phone: string): Promise<EntityDto | null> {
    const row = await entityRepository.findByPhone(getPool(), phone);
    return row === null ? null : mapEntity(row);
  }

  async create(input: EntityWriteRequest, actor: AuditActor): Promise<EntityDto> {
    const id = input.id ?? newId();

    const row = await withTransaction(async (connection) => {
      await this.assertLinkedUserExists(connection, input.linkedUserId ?? null);

      const prefix = CODE_PREFIX[input.type];
      const code =
        input.code !== undefined && input.code.trim() !== ''
          ? input.code.trim()
          : `${prefix}${String((await entityRepository.maxCodeSequence(connection, prefix)) + 1).padStart(CODE_PAD, '0')}`;

      try {
        const created = await entityRepository.insert(connection, {
          id,
          code,
          type: input.type,
          name: input.name,
          nameHi: input.nameHi ?? null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          address: input.address ?? null,
          city: input.city ?? null,
          stateCode: input.stateCode ?? null,
          gstin: input.gstin ?? null,
          pan: input.pan ?? null,
          department: input.department ?? null,
          designation: input.designation ?? null,
          linkedUserId: input.linkedUserId ?? null,
          discountPercent: input.discountPercent ?? 0,
          creditLimit: input.creditLimit ?? 0,
          notes: input.notes ?? null,
          status: input.status ?? MasterStatus.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
          createdBy: actor.userId,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.ENTITY_CREATED,
          entityType: 'entity',
          entityId: created.id,
          after: { code: created.code, type: created.type, name: created.name },
        });
        return created;
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictError(`An entity with code "${code}" already exists`);
        }
        throw error;
      }
    });

    return mapEntity(row);
  }

  async update(
    id: string,
    input: Partial<EntityWriteRequest>,
    actor: AuditActor,
  ): Promise<EntityDto> {
    const row = await withTransaction(async (connection) => {
      const before = await entityRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Entity', id);

      if (input.linkedUserId !== undefined) {
        await this.assertLinkedUserExists(connection, input.linkedUserId);
      }

      const patch: UpdateEntityInput = {};
      const assign = <K extends keyof UpdateEntityInput>(
        key: K,
        value: UpdateEntityInput[K] | undefined,
      ): void => {
        if (value !== undefined) patch[key] = value;
      };

      assign('code', input.code?.trim());
      assign('type', input.type);
      assign('name', input.name);
      assign('nameHi', input.nameHi);
      assign('phone', input.phone);
      assign('email', input.email);
      assign('address', input.address);
      assign('city', input.city);
      assign('stateCode', input.stateCode);
      assign('gstin', input.gstin);
      assign('pan', input.pan);
      assign('department', input.department);
      assign('designation', input.designation);
      assign('linkedUserId', input.linkedUserId);
      assign('discountPercent', input.discountPercent);
      assign('creditLimit', input.creditLimit);
      assign('notes', input.notes);
      assign('status', input.status);
      assign('sortOrder', input.sortOrder);

      let updated;
      try {
        updated = await entityRepository.update(connection, id, patch);
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictError(`An entity with code "${input.code}" already exists`);
        }
        throw error;
      }
      if (updated === null) throw new NotFoundError('Entity', id);

      await auditService.record(connection, actor, {
        action: AuditAction.ENTITY_UPDATED,
        entityType: 'entity',
        entityId: id,
        before: { name: before.name, type: before.type, status: before.status },
        after: { name: updated.name, type: updated.type, status: updated.status },
      });
      return updated;
    });

    return mapEntity(row);
  }

  /**
   * Soft delete, refused while POS history references the entity or while it still owes
   * money — a bill that resolves to nobody is worse than a cluttered list. Deactivate instead.
   */
  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await entityRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Entity', id);

      const posOrders = await entityRepository.countPosOrderReferences(connection, id);
      if (posOrders > 0) {
        throw new ConflictError(
          `${before.name} appears on ${posOrders} POS order(s); set the entity to INACTIVE instead of deleting it`,
        );
      }
      if (Number(before.account_balance) !== 0) {
        throw new ConflictError(
          `${before.name} has an outstanding account balance; settle it before deleting`,
        );
      }

      await entityRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.ENTITY_DELETED,
        entityType: 'entity',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }

  private async assertLinkedUserExists(db: Db, userId: string | null): Promise<void> {
    if (userId === null) return;
    const user = await userRepository.findById(db, userId);
    if (user === null) {
      throw new ValidationError('The linked user account does not exist', [
        { path: 'linkedUserId', message: 'Unknown user' },
      ]);
    }
  }
}

export const entityService = new EntityService();
