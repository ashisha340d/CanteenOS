#!/usr/bin/env node
import { ensureDatabase, migrationStatus, runMigrations } from '../migrator';
import { logger } from '../../utils/logger';

/**
 * CLI: `npm run migrate` applies pending migrations, `npm run migrate:status` reports.
 * Creates the database first if it does not exist, so a fresh machine needs one command.
 */
async function main(): Promise<void> {
  const statusOnly = process.argv.includes('--status');

  if (statusOnly) {
    const records = await migrationStatus();
    for (const record of records) {
      process.stdout.write(
        `${record.status.padEnd(18)} ${record.name}` +
          `${record.appliedAt ? `  (${record.appliedAt})` : ''}\n`,
      );
    }
    const mismatched = records.filter((record) => record.status === 'CHECKSUM_MISMATCH');
    if (mismatched.length > 0) process.exitCode = 1;
    return;
  }

  const createdDatabase = await ensureDatabase();
  if (createdDatabase) process.stdout.write('Database created.\n');

  const { applied, skipped } = await runMigrations();
  process.stdout.write(
    applied.length === 0
      ? `No pending migrations. ${skipped.length} already applied.\n`
      : `Applied ${applied.length} migration(s):\n${applied.map((n) => `  - ${n}`).join('\n')}\n`,
  );
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    logger.error('Migration failed', undefined, error);
    process.exit(1);
  });
