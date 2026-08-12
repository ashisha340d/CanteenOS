import { mutate, selectOne, type Db } from '../db/types';
import type { WebAuthnChallengeRow } from '../models/rows';
import { toDbDateTime } from '../utils/time';

export interface InsertWebAuthnChallengeInput {
  id: string;
  userId: string;
  type: 'registration' | 'authentication';
  challenge: string;
  expiresAt: Date;
}

export class WebAuthnChallengeRepository {
  async insert(db: Db, input: InsertWebAuthnChallengeInput): Promise<void> {
    await mutate(
      db,
      `INSERT INTO webauthn_challenges (id, user_id, type, challenge, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.id, input.userId, input.type, input.challenge, toDbDateTime(input.expiresAt), toDbDateTime()],
    );
  }

  async findValidByUserAndType(
    db: Db,
    userId: string,
    type: 'registration' | 'authentication',
  ): Promise<WebAuthnChallengeRow | null> {
    return selectOne<WebAuthnChallengeRow>(
      db,
      `SELECT id, user_id, type, challenge, expires_at, created_at
       FROM webauthn_challenges
       WHERE user_id = ? AND type = ? AND expires_at > ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, type, toDbDateTime()],
    );
  }

  async deleteById(db: Db, id: string): Promise<void> {
    await mutate(db, 'DELETE FROM webauthn_challenges WHERE id = ?', [id]);
  }

  async deleteExpired(db: Db): Promise<void> {
    await mutate(db, 'DELETE FROM webauthn_challenges WHERE expires_at <= ?', [toDbDateTime()]);
  }
}

export const webAuthnChallengeRepository = new WebAuthnChallengeRepository();
