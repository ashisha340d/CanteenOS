import { mutate, selectRows, type Db } from '../db/types';
import type { BoardRoleCapabilityRow, RoleCapabilityRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

/**
 * The editable role -> capability and board role -> capability grants behind the
 * Admin Portal's Permissions page. `PermissionsCacheService` is the only caller — every
 * authorisation check in the backend reads its in-memory cache, never this repository
 * directly, so a grant lookup never costs a database round trip.
 */
export class PermissionsRepository {
  async listRoleCapabilities(db: Db): Promise<RoleCapabilityRow[]> {
    return selectRows<RoleCapabilityRow>(
      db,
      'SELECT role, capability, updated_by, updated_at FROM role_capabilities',
    );
  }

  async listBoardRoleCapabilities(db: Db): Promise<BoardRoleCapabilityRow[]> {
    return selectRows<BoardRoleCapabilityRow>(
      db,
      'SELECT board_role, capability, updated_by, updated_at FROM board_role_capabilities',
    );
  }

  async grantRoleCapability(
    db: Db,
    role: string,
    capability: string,
    updatedBy: string | null,
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO role_capabilities (role, capability, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [role, capability, updatedBy, toDbDateTime()],
    );
  }

  async revokeRoleCapability(db: Db, role: string, capability: string): Promise<void> {
    await mutate(db, 'DELETE FROM role_capabilities WHERE role = ? AND capability = ?', [
      role,
      capability,
    ]);
  }

  async grantBoardRoleCapability(
    db: Db,
    boardRole: string,
    capability: string,
    updatedBy: string | null,
  ): Promise<void> {
    await mutate(
      db,
      `INSERT INTO board_role_capabilities (board_role, capability, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`,
      [boardRole, capability, updatedBy, toDbDateTime()],
    );
  }

  async revokeBoardRoleCapability(db: Db, boardRole: string, capability: string): Promise<void> {
    await mutate(
      db,
      'DELETE FROM board_role_capabilities WHERE board_role = ? AND capability = ?',
      [boardRole, capability],
    );
  }
}

export const permissionsRepository = new PermissionsRepository();
