import { BoardRole, Capability, UserRole } from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { permissionsRepository } from '../repositories/PermissionsRepository';
import { ForbiddenError, ValidationError } from '../utils/errors';
import { AuditAction, auditService, type AuditActor } from './AuditService';

type RoleCapabilitiesMatrix = Record<UserRole, Capability[]>;
type BoardRoleCapabilitiesMatrix = Record<BoardRole, Capability[]>;

const ALL_CAPABILITIES: readonly string[] = Object.values(Capability);
const ALL_ROLES: readonly string[] = Object.values(UserRole);
const ALL_BOARD_ROLES: readonly string[] = Object.values(BoardRole);

/**
 * The live, editable role -> capability grants.
 *
 * Every authorisation check in the backend (`requireCapability`, `requireBoardAccess`,
 * `TokenService.capabilitiesFor`, the order/attachment/sync services' inline checks) reads
 * this in-memory cache rather than the database or the code-defined defaults in
 * `shared/src/permissions`, so a capability lookup never costs a query. The cache is warmed
 * once at server startup and rebuilt after every admin edit; a stale cache across multiple
 * backend processes is not a concern this deployment has, since it runs as a single instance.
 */
export class PermissionsCacheService {
  private roleCapabilities = new Map<UserRole, Set<Capability>>();
  private boardRoleCapabilities = new Map<BoardRole, Set<Capability>>();

  async load(): Promise<void> {
    const pool = getPool();
    const [roleRows, boardRoleRows] = await Promise.all([
      permissionsRepository.listRoleCapabilities(pool),
      permissionsRepository.listBoardRoleCapabilities(pool),
    ]);

    const roleMap = new Map<UserRole, Set<Capability>>();
    for (const role of Object.values(UserRole)) roleMap.set(role, new Set());
    for (const row of roleRows) {
      roleMap.get(row.role as UserRole)?.add(row.capability as Capability);
    }

    const boardRoleMap = new Map<BoardRole, Set<Capability>>();
    for (const boardRole of Object.values(BoardRole)) boardRoleMap.set(boardRole, new Set());
    for (const row of boardRoleRows) {
      boardRoleMap.get(row.board_role as BoardRole)?.add(row.capability as Capability);
    }

    this.roleCapabilities = roleMap;
    this.boardRoleCapabilities = boardRoleMap;
  }

  roleHasCapability(role: UserRole, capability: Capability): boolean {
    return this.roleCapabilities.get(role)?.has(capability) ?? false;
  }

  boardRoleHasCapability(boardRole: BoardRole, capability: Capability): boolean {
    return this.boardRoleCapabilities.get(boardRole)?.has(capability) ?? false;
  }

  getRoleCapabilities(role: UserRole): Capability[] {
    return [...(this.roleCapabilities.get(role) ?? [])].sort();
  }

  getBoardRoleCapabilities(boardRole: BoardRole): Capability[] {
    return [...(this.boardRoleCapabilities.get(boardRole) ?? [])].sort();
  }

  /** Matches the shape `shared/src/permissions`'s defaults used to have, for the Admin Portal. */
  listAll(): {
    roleCapabilities: RoleCapabilitiesMatrix;
    boardRoleCapabilities: BoardRoleCapabilitiesMatrix;
  } {
    const roleCapabilities = Object.fromEntries(
      Object.values(UserRole).map((role) => [role, this.getRoleCapabilities(role)]),
    ) as RoleCapabilitiesMatrix;
    const boardRoleCapabilities = Object.fromEntries(
      Object.values(BoardRole).map((boardRole) => [boardRole, this.getBoardRoleCapabilities(boardRole)]),
    ) as BoardRoleCapabilitiesMatrix;
    return { roleCapabilities, boardRoleCapabilities };
  }

  async setRoleCapability(
    role: UserRole,
    capability: Capability,
    granted: boolean,
    actor: AuditActor,
  ): Promise<void> {
    assertKnown(ALL_ROLES, role, 'role');
    assertKnown(ALL_CAPABILITIES, capability, 'capability');

    // The Admin Portal can only ever be reached by the ADMIN role; revoking its own ability
    // to read or edit this page would need a direct database edit to undo.
    if (
      role === UserRole.ADMIN &&
      !granted &&
      (capability === Capability.PERMISSION_WRITE || capability === Capability.PERMISSION_READ)
    ) {
      throw new ForbiddenError(
        'The Admin role must always be able to read and edit permissions',
      );
    }

    const before = this.roleHasCapability(role, capability);

    await withTransaction(async (connection) => {
      if (granted) {
        await permissionsRepository.grantRoleCapability(connection, role, capability, actor.userId);
      } else {
        await permissionsRepository.revokeRoleCapability(connection, role, capability);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.PERMISSION_UPDATED,
        entityType: 'role_capability',
        entityId: `${role}:${capability}`,
        before: { granted: before },
        after: { granted },
      });
    });

    await this.load();
  }

  async setBoardRoleCapability(
    boardRole: BoardRole,
    capability: Capability,
    granted: boolean,
    actor: AuditActor,
  ): Promise<void> {
    assertKnown(ALL_BOARD_ROLES, boardRole, 'boardRole');
    assertKnown(ALL_CAPABILITIES, capability, 'capability');

    const before = this.boardRoleHasCapability(boardRole, capability);

    await withTransaction(async (connection) => {
      if (granted) {
        await permissionsRepository.grantBoardRoleCapability(
          connection,
          boardRole,
          capability,
          actor.userId,
        );
      } else {
        await permissionsRepository.revokeBoardRoleCapability(connection, boardRole, capability);
      }

      await auditService.record(connection, actor, {
        action: AuditAction.PERMISSION_UPDATED,
        entityType: 'board_role_capability',
        entityId: `${boardRole}:${capability}`,
        before: { granted: before },
        after: { granted },
      });
    });

    await this.load();
  }
}

function assertKnown(known: readonly string[], value: string, field: string): void {
  if (!known.includes(value)) {
    throw new ValidationError(`Unknown ${field}`, [{ path: field, message: `"${value}" is not recognised` }]);
  }
}

export const permissionsCacheService = new PermissionsCacheService();
