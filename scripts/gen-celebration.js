// Generates the KDS "all clear" celebration as a genuine Lottie file: confetti pieces falling
// and tumbling past a centre burst. Run once — the output is committed, not generated at build
// time. `node scripts/gen-celebration.js kds/src/assets/celebration.json`
const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname } = require('node:path');

const W = 480;
const H = 360;
const FR = 60;
const FRAMES = 150; // 2.5s

const COLOURS = [
  [0.58, 0.55, 1.0, 1], // brand #948dff
  [0.96, 0.62, 0.04, 1], // saffron
  [0.09, 0.64, 0.29, 1], // green
  [0.86, 0.15, 0.47, 1], // pink
  [0.82, 0.52, 0.07, 1], // gold
  [0.15, 0.55, 0.87, 1], // blue
];

function piece(index) {
  const startX = 60 + ((index * 367) % (W - 120));
  const drift = ((index % 5) - 2) * 28;
  const size = 8 + (index % 3) * 5;
  const delay = (index % 6) * 8;
  const colour = COLOURS[index % COLOURS.length];
  const spin = index % 2 === 0 ? 360 : -360;

  return {
    ddd: 0,
    ind: index + 1,
    ty: 4,
    nm: `piece-${index}`,
    ks: {
      o: { a: 0, k: 100 },
      r: {
        a: 1,
        k: [
          { i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] }, t: delay, s: [0], e: [spin] },
          { t: FRAMES, s: [spin] },
        ],
      },
      p: {
        a: 1,
        k: [
          { i: { x: [0.45], y: [0.9] }, o: { x: [0.55], y: [0.1] }, t: delay, s: [startX, -24, 0], e: [startX + drift, H + 30, 0] },
          { t: FRAMES, s: [startX + drift, H + 30, 0] },
        ],
      },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    shapes: [
      {
        ty: 'gr',
        nm: `group-${index}`,
        it: [
          {
            ty: 'rc',
            d: 1,
            nm: 'rect',
            s: { a: 0, k: [size, size * 0.55] },
            p: { a: 0, k: [0, 0] },
            r: { a: 0, k: 2 },
          },
          { ty: 'fl', nm: 'fill', c: { a: 0, k: colour }, o: { a: 0, k: 100 } },
          {
            ty: 'tr',
            p: { a: 0, k: [0, 0] },
            a: { a: 0, k: [0, 0] },
            s: { a: 0, k: [100, 100] },
            r: { a: 0, k: 0 },
            o: { a: 0, k: 100 },
          },
        ],
      },
    ],
    ip: delay,
    op: FRAMES,
    st: 0,
  };
}

const animation = {
  v: '5.9.0',
  fr: FR,
  ip: 0,
  op: FRAMES,
  w: W,
  h: H,
  nm: 'kds-celebration',
  ddd: 0,
  assets: [],
  layers: Array.from({ length: 18 }, (_, i) => piece(i)),
};

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/gen-celebration.js <output.json>');
  process.exit(1);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(animation));
console.log(`wrote ${out} (${animation.layers.length} layers)`);
