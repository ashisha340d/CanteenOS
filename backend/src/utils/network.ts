import os from 'node:os';

export interface NetworkAddresses {
  lan: string[];
  tailscale: string[];
}

// Tailscale assigns addresses from the CGNAT range 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
const TAILSCALE_CGNAT = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;

/** Non-loopback IPv4 addresses this machine is reachable on, split out from any Tailscale address. */
export function getLocalNetworkAddresses(): NetworkAddresses {
  const lan: string[] = [];
  const tailscale: string[] = [];

  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const addr of addresses ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      if (TAILSCALE_CGNAT.test(addr.address) || /tailscale/i.test(name)) {
        tailscale.push(addr.address);
      } else {
        lan.push(addr.address);
      }
    }
  }

  return { lan, tailscale };
}
