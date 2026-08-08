import { config } from '../config';

const PRIVATE_LAN_HOSTNAME = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/;
// Tailscale's CGNAT range: 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
const TAILSCALE_HOSTNAME = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/**
 * Outside production, the admin UI is routinely opened from whatever address it happens to be
 * reachable at that day — the machine's LAN IP changes with DHCP, and Tailscale assigns its own
 * range — so an exact-match CORS allowlist would need updating every time. Anything on a private
 * network or Tailscale is trusted equally to localhost in that case; production keeps the strict
 * exact-match allowlist in `config.corsOrigins`.
 */
export function isPrivateNetworkOrigin(origin: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    PRIVATE_LAN_HOSTNAME.test(hostname) ||
    TAILSCALE_HOSTNAME.test(hostname)
  );
}

/**
 * The single CORS decision, shared by Express and Socket.IO so a browser that can call the
 * REST API can always open the realtime socket too. An undefined origin is a native app or
 * server-to-server call, which CORS does not govern.
 */
export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  return (
    origin === undefined ||
    config.corsOrigins.includes(origin) ||
    (!config.isProduction && isPrivateNetworkOrigin(origin))
  );
}
