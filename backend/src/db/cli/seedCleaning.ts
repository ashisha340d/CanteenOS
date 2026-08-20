#!/usr/bin/env node
import { UserRole } from '@menuboard/shared';
import { closePool, getPool } from '../pool';
import { withTransaction } from '../transaction';
import { seedCleaning } from '../seeds/seedCleaning';
import { userRepository } from '../../repositories/UserRepository';
import { logger } from '../../utils/logger';

/**
 * Provisions the Cleaning module's carrier data on its own.
 *
 * `npm run seed` does this too, as part of the whole seed. This exists because the cleaning
 * carrier rows are the one thing the module cannot start without, and an installation whose
 * user seeding has diverged (accounts renamed, retired or replaced) must still be able to
 * provision them without re-running everything else.
 *
 * Idempotent, like `seedCleaning` itself.
 */
async function main(): Promise<void> {
  const pool = getPool();
  const admins = await userRepository.findActiveByRoles(pool, [
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
  ]);
  const owner = admins[0];
  if (owner === undefined) {
    throw new Error(
      'No active Super Admin or Admin account exists to attribute the seeded rows to.',
    );
  }

  await withTransaction((connection) => seedCleaning(connection, owner.id));
  process.stdout.write(
    `\nCleaning seed complete (attributed to ${owner.username}).\n\n` +
      'Provisioned, if absent:\n' +
      '  CLN-REPORTED  procedure + published version + rule — carries reported clean-ups\n' +
      '  global cleaning assignment policy\n',
  );
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error('Cleaning seed failed', undefined, error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
