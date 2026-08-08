import { config } from '../config';
import { getLocalNetworkAddresses } from './network';

/** Mirrors the accounts created by `npm run seed` (backend/src/db/seeds/seed.ts). */
const SEEDED_ACCOUNTS = [
  { username: 'superadmin', globalRole: 'SUPER_ADMIN', boardRole: 'OWNER' },
  { username: 'admin', globalRole: 'ADMIN', boardRole: 'OWNER' },
  { username: 'manager', globalRole: 'MANAGER', boardRole: 'MANAGER' },
  { username: 'user1', globalRole: 'USER', boardRole: 'MEMBER' },
  { username: 'user2', globalRole: 'USER', boardRole: 'MEMBER' },
] as const;

const LABEL_WIDTH = 11;

function addressLine(label: string, host: string): string {
  return `  ${`${label}:`.padEnd(LABEL_WIDTH)} http://${host}:${config.port}`;
}

/**
 * Plain, human-facing startup summary. Deliberately bypasses the JSON logger (which is meant
 * for log shippers, not for humans watching a terminal) so `npm start` prints one readable
 * block instead of a wall of structured log lines.
 */
export function printStartupBanner(): void {
  const { lan, tailscale } = getLocalNetworkAddresses();

  const lines: string[] = ['', '  MenuBoard backend ready', ''];
  lines.push(addressLine('Local', 'localhost'));
  for (const ip of lan) lines.push(addressLine('Network', ip));
  for (const ip of tailscale) lines.push(addressLine('Tailscale', ip));

  // Seeded accounts only ever exist outside production, and only after `npm run seed` has
  // actually been run — but printing the reference here regardless of whether it has is a
  // reasonable trade for the convenience, since the values are static and non-sensitive
  // (localhost-only dev seed data, not a live secret).
  if (!config.isProduction) {
    const seedPassword = process.env.SEED_PASSWORD ?? 'MenuBoard@2026';
    const userWidth = Math.max(...SEEDED_ACCOUNTS.map((a) => a.username.length), 'Username'.length);
    const roleWidth = Math.max(...SEEDED_ACCOUNTS.map((a) => a.globalRole.length), 'Global Role'.length);

    lines.push('', '  Seeded accounts (dev)');
    lines.push(
      `  ${'Username'.padEnd(userWidth)}  ${'Password'.padEnd(seedPassword.length)}  ${'Global Role'.padEnd(roleWidth)}  Board Role`,
    );
    for (const account of SEEDED_ACCOUNTS) {
      lines.push(
        `  ${account.username.padEnd(userWidth)}  ${seedPassword.padEnd(seedPassword.length)}  ${account.globalRole.padEnd(roleWidth)}  ${account.boardRole}`,
      );
    }
  }

  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}
