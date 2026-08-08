#!/usr/bin/env node
import { closePool } from '../pool';
import { seed } from '../seeds/seed';
import { logger } from '../../utils/logger';

async function main(): Promise<void> {
  await seed();
  process.stdout.write(
    '\nSeed complete.\n\n' +
      'Sign-in accounts (all share the same password and must change it on first sign-in):\n' +
      '  superadmin  Super Admin\n' +
      '  admin       Admin\n' +
      '  manager     Manager\n' +
      '  user1       User\n' +
      '  user2       User\n\n' +
      `Password: ${process.env.SEED_PASSWORD ?? 'MenuBoard@2026'}\n`,
  );
}

main()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    logger.error('Seed failed', undefined, error);
    await closePool().catch(() => undefined);
    process.exit(1);
  });
