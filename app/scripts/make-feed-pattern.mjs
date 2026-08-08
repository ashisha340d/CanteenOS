/**
 * Generates `assets/feed-pattern.png` — the tiled doodle wallpaper behind the board feed.
 *
 * This exists so the repository always contains a valid asset at that path and the bundle
 * never breaks on a missing `require`. It is a stand-in: replace the PNG with the real
 * artwork whenever you have it, at the same path and no code change is needed.
 *
 * Hand-rolled PNG encoding (zlib + CRC) rather than a drawing library, because pulling a
 * canvas dependency into the app workspace to produce one static file is a poor trade.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 256;
// Warm paper, with the doodles only a few shades darker — the pattern has to stay behind the
// content, not compete with it.
const BG = [0xf3, 0xf0, 0xe9];
const INK = [0xe6, 0xe1, 0xd6];

const pixels = Buffer.alloc(SIZE * SIZE * 3);
for (let i = 0; i < SIZE * SIZE; i += 1) {
  pixels[i * 3] = BG[0];
  pixels[i * 3 + 1] = BG[1];
  pixels[i * 3 + 2] = BG[2];
}

function plot(x, y) {
  // Wrap, so every shape tiles seamlessly across the edges.
  const px = ((Math.round(x) % SIZE) + SIZE) % SIZE;
  const py = ((Math.round(y) % SIZE) + SIZE) % SIZE;
  const offset = (py * SIZE + px) * 3;
  pixels[offset] = INK[0];
  pixels[offset + 1] = INK[1];
  pixels[offset + 2] = INK[2];
}

function circle(cx, cy, r) {
  const steps = Math.max(24, Math.ceil(2 * Math.PI * r));
  for (let i = 0; i < steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    plot(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    plot(cx + Math.cos(a) * (r + 0.5), cy + Math.sin(a) * (r + 0.5));
  }
}

function roundedBox(cx, cy, w, h) {
  for (let x = -w; x <= w; x += 0.5) {
    plot(cx + x, cy - h);
    plot(cx + x, cy + h);
  }
  for (let y = -h; y <= h; y += 0.5) {
    plot(cx - w, cy + y);
    plot(cx + w, cy + y);
  }
}

function squiggle(cx, cy, w) {
  for (let x = -w; x <= w; x += 0.5) {
    plot(cx + x, cy + Math.sin((x / w) * Math.PI * 2) * 3);
  }
}

function star(cx, cy, r) {
  for (let i = 0; i < 5; i += 1) {
    const a1 = (i / 5) * Math.PI * 2 - Math.PI / 2;
    const a2 = ((i + 2) / 5) * Math.PI * 2 - Math.PI / 2;
    for (let t = 0; t <= 1; t += 0.02) {
      plot(
        cx + (Math.cos(a1) * r) * (1 - t) + (Math.cos(a2) * r) * t,
        cy + (Math.sin(a1) * r) * (1 - t) + (Math.sin(a2) * r) * t,
      );
    }
  }
}

// A fixed, hand-placed scatter rather than a random one, so regenerating the file produces
// byte-identical output and does not churn in git.
circle(34, 30, 13);
star(120, 26, 10);
roundedBox(200, 34, 14, 9);
squiggle(70, 74, 16);
circle(160, 84, 9);
star(238, 92, 8);
roundedBox(30, 118, 10, 13);
squiggle(190, 132, 20);
circle(108, 140, 15);
star(46, 186, 9);
roundedBox(140, 196, 16, 10);
circle(216, 176, 11);
squiggle(96, 226, 14);
star(178, 240, 8);
circle(20, 246, 10);
roundedBox(250, 220, 9, 12);

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
