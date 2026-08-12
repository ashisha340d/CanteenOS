// Kills any process currently listening on the dev ports (backend 4000, admin 5173)
// so `npm run dev` can be re-run without manually stopping the previous instance.
const { execSync } = require('node:child_process');

const PORTS = [4000, 5173];
// Windows holds a listening socket for a moment after the owner dies, so a kill that "worked"
// can still be followed by EADDRINUSE. Poll until the port is genuinely unowned.
const RELEASE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;

/**
 * `netstat -ano` without `-p` so both address families are listed: Vite binds `[::1]:5173`,
 * which an IPv4-only listing does not show at all — the port then looks free right up until
 * the dev server fails with EADDRINUSE.
 */
function listeningPids(port) {
  let output;
  try {
    output = execSync('netstat -ano', { encoding: 'utf8' });
  } catch {
    return [];
  }

  const pids = new Set();
  for (const line of output.split('\n')) {
    // Local address is either `1.2.3.4:port` or `[::1]:port`; take whatever follows the last colon.
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (match && Number(match[1]) === port && match[2] !== '0') {
      pids.add(match[2]);
    }
  }
  return [...pids];
}

function killPort(port) {
  const pids = listeningPids(port);
  for (const pid of pids) {
    try {
      // /T takes the whole tree: vite and tsx both run under a cmd.exe shim, and killing only
      // the shim leaves the server holding the socket.
      execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      console.log(`[free-ports] killed pid ${pid} on port ${port}`);
    } catch {
      // process may have already exited
    }
  }
  return pids.length;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

for (const port of PORTS) {
  killPort(port);
  const deadline = Date.now() + RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline && listeningPids(port).length > 0) {
    sleep(POLL_INTERVAL_MS);
    killPort(port);
  }
  if (listeningPids(port).length > 0) {
    console.warn(`[free-ports] port ${port} is still in use — the dev server may fail to start`);
  }
}
