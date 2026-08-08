import {
  UserRole,
  UserStatus,
  type CreateUserRequest,
  type UpdateUserRequest,
  type UserDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapUser } from '../models/mappers';
import { refreshTokenRepository } from '../repositories/RefreshTokenRepository';
import { userRepository, type UserListFilter } from '../repositories/UserRepository';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { hashPassword } from '../utils/password';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface UserQuery {
  search?: string;
  role?: UserRole;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
  sortBy?: UserListFilter['sortBy'];
  sortDir?: 'asc' | 'desc';
}

/**
 * User administration. Admin Portal only — `USER_WRITE` is in
 * ANDROID_FORBIDDEN_CAPABILITIES, so no Android session can reach these methods.
 */
export class UserService {
  async list(query: UserQuery) {
    const { page, pageSize, offset } = resolvePaging(query);
    const { rows, total } = await userRepository.list(getPool(), {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.role !== undefined ? { role: query.role } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.sortBy !== undefined ? { sortBy: query.sortBy } : {}),
      ...(query.sortDir !== undefined ? { sortDir: query.sortDir } : {}),
      limit: pageSize,
      offset,
    });
    return buildPage(rows.map(mapUser), total, page, pageSize);
  }

  async getById(id: string): Promise<UserDto> {
    const row = await userRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('User', id);
    return mapUser(row);
  }

  async create(input: CreateUserRequest, actor: AuditActor): Promise<UserDto> {
    this.assertMayAssignRole(actor, input.role);
    const passwordHash = await hashPassword(input.password);

    return withTransaction(async (connection) => {
      const existing = await userRepository.findByUsername(connection, input.username);
      if (existing !== null) {
        throw new ConflictError(`Username "${input.username}" is already taken`);
      }

      const row = await userRepository.insert(connection, {
        id: input.id ?? newId(),
        employeeCode: input.employeeCode ?? null,
        name: input.name,
        username: input.username,
        phone: input.phone ?? null,
        email: input.email ?? null,
        passwordHash,
        role: input.role,
        status: input.status ?? UserStatus.ACTIVE,
        // A user created by an administrator must set their own password on first sign-in.
        mustChangePassword: true,
        createdBy: actor.userId,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.USER_CREATED,
        entityType: 'user',
        entityId: row.id,
        after: { username: row.username, role: row.role, status: row.status },
      });

      return mapUser(row);
    });
  }

  async update(id: string, input: UpdateUserRequest, actor: AuditActor): Promise<UserDto> {
    if (input.role !== undefined) this.assertMayAssignRole(actor, input.role);

    const passwordHash =
      input.password !== undefined ? await hashPassword(input.password) : undefined;

    return withTransaction(async (connection) => {
      const before = await userRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('User', id);

      // Demoting or deactivating the last active Super Admin would lock everyone out.
      const losingSuperAdmin =
        before.role === UserRole.SUPER_ADMIN &&
        ((input.role !== undefined && input.role !== UserRole.SUPER_ADMIN) ||
          (input.status !== undefined && input.status !== UserStatus.ACTIVE));

      if (losingSuperAdmin) {
        const remaining = await userRepository.countByRole(connection, UserRole.SUPER_ADMIN);
        if (remaining <= 1) {
          throw new ConflictError(
            'At least one active Super Admin must remain; promote another user first',
          );
        }
      }

      const row = await userRepository.update(connection, id, {
        ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(passwordHash !== undefined ? { passwordHash, mustChangePassword: true } : {}),
      });
      if (row === null) throw new NotFoundError('User', id);

      // A role change, deactivation or admin password reset must end existing sessions.
      const shouldRevokeSessions =
        passwordHash !== undefined ||
        (input.role !== undefined && input.role !== before.role) ||
        (input.status !== undefined && input.status !== UserStatus.ACTIVE);

      if (shouldRevokeSessions) {
        await refreshTokenRepository.revokeAllForUser(connection, id);
      }

      await auditService.record(connection, actor, {
        action:
          input.role !== undefined && input.role !== before.role
            ? AuditAction.USER_ROLE_CHANGED
            : AuditAction.USER_UPDATED,
        entityType: 'user',
        entityId: id,
        before: { role: before.role, status: before.status, name: before.name },
        after: { role: row.role, status: row.status, name: row.name },
      });

      return mapUser(row);
    });
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await userRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('User', id);

      if (before.id === actor.userId) {
        throw new ValidationError('You cannot delete your own account');
      }
      if (before.role === UserRole.SUPER_ADMIN) {
        const remaining = await userRepository.countByRole(connection, UserRole.SUPER_ADMIN);
        if (remaining <= 1) {
          throw new ConflictError('The last active Super Admin cannot be deleted');
        }
      }

      await userRepository.softDelete(connection, id);
      await refreshTokenRepository.revokeAllForUser(connection, id);

      await auditService.record(connection, actor, {
        action: AuditAction.USER_DELETED,
        entityType: 'user',
        entityId: id,
        before: { username: before.username, role: before.role },
      });
    });
  }

  /**
   * Only a Super Admin may create or promote to Super Admin. Without this an Admin could
   * escalate their own privileges by minting a peer above them.
   */
  private assertMayAssignRole(actor: AuditActor, role: UserRole): void {
    if (role === UserRole.SUPER_ADMIN && actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only a Super Admin can assign the Super Admin role');
    }
  }
}

export const userService = new UserService();
