const { networkInterfaces } = require('node:os');

const APPS = [
  { name: 'kds', url: 'http://localhost:5185', note: 'sign in, pick counter or kitchen' },
  { name: 'cds', url: 'http://localhost:5185', note: 'same sign-in, pick customer display' },
  { name: 'digitalmenu', url: 'http://localhost:4000/menu-board?screen=MAIN', note: '' },
  { name: 'kiosk', url: 'http://localhost:5180', note: '' },
  { name: 'admin', url: 'http://localhost:5173', note: '' },
];

function addresses() {
  const tailscale = [];
  const lan = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (/^(vEthernet|Loopback|Docker|WSL)/i.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const [a, b] = entry.address.split('.').map(Number);
      (a === 100 && b >= 64 && b <= 127 ? tailscale : lan).push(entry.address);
    }
  }
  return { tailscale, lan };
}

const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const cyan = (text) => `\x1b[36m${text}\x1b[0m`;

const lines = [''];

for (const app of APPS) {
  const note = app.note === '' ? '' : `  ${dim(app.note)}`;
  lines.push(`  ${app.name.padEnd(12)} ${cyan(app.url)}${note}`);
}

const { tailscale, lan } = addresses();
if (tailscale.length + lan.length > 0) {
  lines.push('', '  network:');
  for (const ip of tailscale) {
    lines.push(`  ${'tailscale'.padEnd(12)} ${cyan(`http://${ip}:5180`)}  ${dim('kiosk · kds/cds :5185 · menu :4000/menu-board?screen=MAIN')}`);
  }
  for (const ip of lan) {
    lines.push(`  ${'lan'.padEnd(12)} ${cyan(`http://${ip}:5180`)}  ${dim('kiosk · kds/cds :5185 · menu :4000/menu-board?screen=MAIN')}`);
  }
}

lines.push('');
console.log(lines.join('\n'));
