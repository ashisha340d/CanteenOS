/**
 * Generates `assets/feed-pattern.png` — the tiled doodle wallpaper behind the board feed.
 *
 * Reproduces WhatsApp's light-theme chat wallpaper: warm paper `#EFEAE2` scattered with faint
 * `#DCD3C6` line doodles. Hand-rolled PNG encoding (zlib + CRC) rather than a drawing library,
 * because pulling a canvas dependency into the app workspace to produce one static file is a
 * poor trade.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 300;
const BG = [0xef, 0xea, 0xe2];
const INK = [0xdc, 0xd3, 0xc6];

const pixels = Buffer.alloc(SIZE * SIZE * 3);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  pixels[i * 3] = BG[0];
  pixels[i * 3 + 1] = BG[1];
  pixels[i * 3 + 2] = BG[2];
}

function plot(x, y) {
  const px = ((Math.round(x) % SIZE) + SIZE) % SIZE;
  const py = ((Math.round(y) % SIZE) + SIZE) % SIZE;
  const offset = (py * SIZE + px) * 3;
  pixels[offset] = INK[0];
  pixels[offset + 1] = INK[1];
  pixels[offset + 2] = INK[2];
}

function line(x1, y1, x2, y2) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    plot(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t);
  }
}

function arc(cx, cy, r, from, to) {
  const steps = Math.max(16, Math.ceil(Math.abs(to - from) * r * 2));
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    plot(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

const circle = (cx, cy, r) => arc(cx, cy, r, 0, Math.PI * 2);

function roundedRect(cx, cy, w, h, r) {
  line(cx - w + r, cy - h, cx + w - r, cy - h);
  line(cx - w + r, cy + h, cx + w - r, cy + h);
  line(cx - w, cy - h + r, cx - w, cy + h - r);
  line(cx + w, cy - h + r, cx + w, cy + h - r);
  arc(cx - w + r, cy - h + r, r, Math.PI, Math.PI * 1.5);
  arc(cx + w - r, cy - h + r, r, Math.PI * 1.5, Math.PI * 2);
  arc(cx + w - r, cy + h - r, r, 0, Math.PI * 0.5);
  arc(cx - w + r, cy + h - r, r, Math.PI * 0.5, Math.PI);
}

/* ------------------------------------------------------------ doodle set */

function chatBubble(cx, cy, s) {
  roundedRect(cx, cy, s, s * 0.72, s * 0.3);
  line(cx - s * 0.35, cy + s * 0.72, cx - s * 0.15, cy + s * 1.1);
  line(cx - s * 0.15, cy + s * 1.1, cx - s * 0.05, cy + s * 0.72);
}

function heart(cx, cy, s) {
  arc(cx - s * 0.5, cy - s * 0.2, s * 0.5, Math.PI, Math.PI * 2);
  arc(cx + s * 0.5, cy - s * 0.2, s * 0.5, Math.PI, Math.PI * 2);
  line(cx - s, cy - s * 0.2, cx, cy + s);
  line(cx + s, cy - s * 0.2, cx, cy + s);
}

function camera(cx, cy, s) {
  roundedRect(cx, cy, s, s * 0.68, s * 0.22);
  circle(cx, cy + s * 0.05, s * 0.34);
  line(cx - s * 0.4, cy - s * 0.68, cx - s * 0.25, cy - s * 0.95);
  line(cx + s * 0.1, cy - s * 0.68, cx - s * 0.25, cy - s * 0.95);
  line(cx - s * 0.4, cy - s * 0.68, cx + s * 0.1, cy - s * 0.68);
}

function musicNote(cx, cy, s) {
  circle(cx - s * 0.45, cy + s * 0.7, s * 0.32);
  circle(cx + s * 0.6, cy + s * 0.45, s * 0.32);
  line(cx - s * 0.14, cy + s * 0.7, cx - s * 0.14, cy - s * 0.8);
  line(cx + s * 0.9, cy + s * 0.45, cx + s * 0.9, cy - s * 1.05);
  line(cx - s * 0.14, cy - s * 0.8, cx + s * 0.9, cy - s * 1.05);
}

function star(cx, cy, r) {
  for (let i = 0; i < 5; i += 1) {
    const a1 = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a2 = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2;
    line(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
  }
}

function cup(cx, cy, s) {
  line(cx - s * 0.7, cy - s * 0.6, cx - s * 0.5, cy + s * 0.8);
  line(cx + s * 0.7, cy - s * 0.6, cx + s * 0.5, cy + s * 0.8);
  line(cx - s * 0.5, cy + s * 0.8, cx + s * 0.5, cy + s * 0.8);
  line(cx - s * 0.7, cy - s * 0.6, cx + s * 0.7, cy - s * 0.6);
  arc(cx + s * 0.75, cy, s * 0.4, -Math.PI * 0.5, Math.PI * 0.5);
  line(cx - s * 0.25, cy - s * 1.3, cx - s * 0.25, cy - s * 0.8);
  line(cx + s * 0.2, cy - s * 1.3, cx + s * 0.2, cy - s * 0.8);
}

function balloon(cx, cy, s) {
  circle(cx, cy, s * 0.7);
  line(cx, cy + s * 0.7, cx, cy + s * 1.5);
  line(cx - s * 0.15, cy + s * 1.5, cx + s * 0.15, cy + s * 1.5);
}

function leaf(cx, cy, s) {
  arc(cx, cy, s, -Math.PI * 0.75, -Math.PI * 0.05);
  arc(cx, cy, s, Math.PI * 0.25, Math.PI * 0.95);
  line(cx - s * 0.7, cy + s * 0.7, cx + s * 0.7, cy - s * 0.7);
}

function smiley(cx, cy, r) {
  circle(cx, cy, r);
  circle(cx - r * 0.35, cy - r * 0.25, r * 0.1);
  circle(cx + r * 0.35, cy - r * 0.25, r * 0.1);
  arc(cx, cy + r * 0.05, r * 0.5, Math.PI * 0.2, Math.PI * 0.8);
}

function plane(cx, cy, s) {
  line(cx - s, cy, cx + s, cy - s * 0.5);
  line(cx + s, cy - s * 0.5, cx - s * 0.2, cy + s * 0.8);
  line(cx - s * 0.2, cy + s * 0.8, cx - s * 0.35, cy + s * 0.1);
  line(cx - s * 0.35, cy + s * 0.1, cx - s, cy);
}

function clock(cx, cy, r) {
  circle(cx, cy, r);
  line(cx, cy, cx, cy - r * 0.6);
  line(cx, cy, cx + r * 0.45, cy);
}

// A fixed, hand-placed scatter rather than a random one, so regenerating the file produces
// byte-identical output and does not churn in git.
chatBubble(40, 34, 12);
heart(128, 28, 9);
camera(214, 40, 12);
musicNote(276, 108, 9);
star(58, 108, 11);
smiley(152, 104, 13);
cup(232, 152, 11);
plane(36, 176, 12);
balloon(112, 176, 11);
leaf(196, 214, 12);
clock(272, 224, 12);
chatBubble(76, 248, 11);
heart(150, 268, 9);
star(226, 284, 10);
smiley(292, 20, 11);
musicNote(6, 254, 9);
camera(120, 214, 10);
cup(20, 82, 9);

// PNG: each scanline is prefixed with a filter byte (0 = None).
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 3 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 3 + 1) + 1, y * SIZE * 3, (y + 1) * SIZE * 3);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/feed-pattern.png');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
process.stdout.write(`wrote ${out} (${png.length} bytes)\n`);
