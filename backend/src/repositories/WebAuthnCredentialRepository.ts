import { mutate, selectOne, selectRows, type Db } from '../db/types';
import type { WebAuthnCredentialRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface InsertWebAuthnCredentialInput {
  id: string;
  credentialId: string;
  userId: string;
  publicKey: string;
  signCounter: number;
  transports: string;
  backupEligible: boolean;
  backupState: boolean;
  deviceName: string | null;
}

export class WebAuthnCredentialRepository {
  async findByCredentialId(db: Db, credentialId: string): Promise<WebAuthnCredentialRow | null> {
    return selectOne<WebAuthnCredentialRow>(
      db,
      `SELECT id, credential_id, user_id, public_key, sign_counter, transports,
              backup_eligible, backup_state, device_name, last_used_at, revoked_at,
              created_at, updated_at
       FROM webauthn_credentials
       WHERE credential_id = ?`,
      [credentialId],
    );
  }

  async listActiveByUserId(db: Db, userId: string): Promise<WebAuthnCredentialRow[]> {
    return selectRows<WebAuthnCredentialRow>(
      db,
      `SELECT id, credential_id, user_id, public_key, sign_counter, transports,
              backup_eligible, backup_state, device_name, last_used_at, revoked_at,
              created_at, updated_at
       FROM webauthn_credentials
       WHERE user_id = ? AND revoked_at IS NULL`,
      [userId],
    );
  }

  async insert(db: Db, input: InsertWebAuthnCredentialInput): Promise<void> {
    const now = toDbDateTime();
    await mutate(
      db,
      `INSERT INTO webauthn_credentials
         (id, credential_id, user_id, public_key, sign_counter, transports,
          backup_eligible, backup_state, device_name, last_used_at, revoked_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      [
        input.id,
        input.credentialId,
        input.userId,
        input.publicKey,
        input.signCounter,
        input.transports,
        input.backupEligible ? 1 : 0,
        input.backupState ? 1 : 0,
        input.deviceName,
        now,
        now,
      ],
    );
  }

  async revoke(db: Db, id: string): Promise<void> {
    await mutate(
      db,
      'UPDATE webauthn_credentials SET revoked_at = ?, updated_at = ? WHERE id = ?',
      [toDbDateTime(), toDbDateTime(), id],
    );
  }

  async updateCounterAndLastUsed(
    db: Db,
    id: string,
    signCounter: number,
  ): Promise<void> {
    await mutate(
      db,
      'UPDATE webauthn_credentials SET sign_counter = ?, last_used_at = ?, updated_at = ? WHERE id = ?',
      [signCounter, toDbDateTime(), toDbDateTime(), id],
    );
  }
}

export const webAuthnCredentialRepository = new WebAuthnCredentialRepository();
