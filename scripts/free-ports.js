// Kills any process currently listening on the dev ports (backend 4000, admin 5173)
// so `npm run dev` can be re-run without manually stopping the previous instance.
const { execSync } = require('node:child_process');

const PORTS = [4000, 5173];

function killPort(port) {
  let output;
  try {
    output = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
  } catch {
    return;
  }

  const pids = new Set();
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
    if (match && Number(match[1]) === port) {
      pids.add(match[2]);
    }
  }

  for (const pid of pids) {
    if (pid === '0') continue;
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      console.log(`[free-ports] killed pid ${pid} on port ${port}`);
    } catch {
      // process may have already exited
    }
  }
}

for (const port of PORTS) {
  killPort(port);
}
