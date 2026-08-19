import { config } from '../config';
import { getLocalNetworkAddresses } from './network';

const APPS = [
  { name: 'ADMIN', port: 5173, path: '/' },
  { name: 'KIOSK', port: 5180, path: '/' },
  { name: 'KDS', port: 5185, path: '/' },
  { name: 'CDS', port: 5185, path: '/?mode=cds' },
] as const;

/**
 * Plain, human-facing startup summary. Deliberately bypasses the JSON logger (which is meant
 * for log shippers, not for humans watching a terminal) so boot prints one readable block:
 * where the API is, and a link per app. Nothing else — logs belong to the logger.
 */
export function printStartupBanner(): void {
  const { lan, tailscale } = getLocalNetworkAddresses();
  const network = [...lan, ...tailscale];

  const lines: string[] = ['', '  Canteen OS ready', ''];
  lines.push(`  API     : http://localhost:${config.port}`);
  for (const ip of network) lines.push(`  NETWORK : http://${ip}:${config.port}`);
  lines.push('');
  for (const app of APPS) {
    lines.push(`  ${app.name.padEnd(6)}: http://localhost:${app.port}${app.path}`);
  }
  lines.push('');
  process.stdout.write(`${lines.join('\n')}\n`);
}
