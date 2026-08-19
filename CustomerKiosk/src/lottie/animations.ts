/**
 * The kiosk's four Lottie marks, authored in code rather than pasted in as JSON.
 *
 * A hand-written Lottie file is 400 lines of coordinates nobody can review and nobody can
 * adjust; the same animation described as "eight petals, a wave travelling round them" is a
 * dozen. Everything below emits ordinary bodymovin JSON — `lottie-web` cannot tell the
 * difference — but the timing is a function of the frame rather than a table of magic numbers,
 * so a loop is provably seamless: the value at the last frame is the value at the first.
 *
 * Colour is deliberately flat white here. The player is wrapped in `.lottie-tint`, whose CSS
 * repaints every fill with `currentColor`, so one mark serves all four skins and a skin change
 * does not need four copies of the same file.
 */

/* ------------------------------------------------------------------ bodymovin shapes */

type Vec = number[];

interface ValueKeyframe {
  t: number;
  s: Vec;
  i?: { x: number[]; y: number[] };
  o?: { x: number[]; y: number[] };
}

interface StaticProperty {
  a: 0;
  k: number | Vec;
}

interface AnimatedProperty {
  a: 1;
  k: ValueKeyframe[];
}

type Property = StaticProperty | AnimatedProperty;

export interface LottieAnimation {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: never[];
  layers: unknown[];
}

const EASE_IN = { x: [0.4], y: [0] };
const EASE_OUT = { x: [0.2], y: [1] };

function still(value: number | Vec): StaticProperty {
  return { a: 0, k: value };
}

/**
 * Samples a continuous function once per step across the loop and lands the final keyframe on
 * the first one's value. That closure is what makes the loop invisible — a sampled curve whose
 * ends disagree shows a jump every cycle, which on a kiosk loader reads as a stutter.
 */
function sampled(
  frames: number,
  steps: number,
  at: (phase: number) => number | Vec,
): AnimatedProperty {
  const keyframes: ValueKeyframe[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const time = Math.round((frames * step) / steps);
    const value = at((step % steps) / steps);
    keyframes.push({
      t: time,
      s: Array.isArray(value) ? value : [value],
      i: EASE_OUT,
      o: EASE_IN,
    });
  }
  return { a: 1, k: keyframes };
}

function keyed(points: { t: number; v: number | Vec }[]): AnimatedProperty {
  return {
    a: 1,
    k: points.map((point) => ({
      t: point.t,
      s: Array.isArray(point.v) ? point.v : [point.v],
      i: EASE_OUT,
      o: EASE_IN,
    })),
  };
}

interface Transform {
  position?: Vec;
  anchor?: Vec;
  rotation?: number;
  scale?: Property;
  opacity?: Property;
}

/** The `tr` entry every shape group ends with. */
function groupTransform(): Record<string, unknown> {
  return {
    ty: 'tr',
    p: still([0, 0]),
    a: still([0, 0]),
    s: still([100, 100]),
    r: still(0),
    o: still(100),
    sk: still(0),
    sa: still(0),
  };
}

function shapeLayer(
  name: string,
  index: number,
  frames: number,
  transform: Transform,
  shapes: unknown[],
): Record<string, unknown> {
  return {
    ddd: 0,
    ind: index,
    ty: 4,
    nm: name,
    sr: 1,
    ks: {
      o: transform.opacity ?? still(100),
      r: still(transform.rotation ?? 0),
      p: still(transform.position ?? [0, 0, 0]),
      a: still(transform.anchor ?? [0, 0, 0]),
      s: transform.scale ?? still([100, 100, 100]),
    },
    ao: 0,
    shapes: [{ ty: 'gr', nm: `${name}-group`, it: [...shapes, groupTransform()] }],
    ip: 0,
    op: frames,
    st: 0,
    bm: 0,
  };
}

function ellipse(position: Vec, size: Vec): Record<string, unknown> {
  return { ty: 'el', d: 1, p: still(position), s: still(size), nm: 'ellipse' };
}

function roundedRect(position: Vec, size: Vec, radius: number): Record<string, unknown> {
  return { ty: 'rc', d: 1, p: still(position), s: still(size), r: still(radius), nm: 'rect' };
}

function polyline(vertices: Vec[]): Record<string, unknown> {
  return {
    ty: 'sh',
    d: 1,
    nm: 'path',
    ks: {
      a: 0,
      k: {
        i: vertices.map(() => [0, 0]),
        o: vertices.map(() => [0, 0]),
        v: vertices,
        c: false,
      },
    },
  };
}

function fill(opacity = 100): Record<string, unknown> {
  return { ty: 'fl', c: still([1, 1, 1, 1]), o: still(opacity), r: 1, nm: 'fill' };
}

function stroke(width: number, opacity = 100): Record<string, unknown> {
  return {
    ty: 'st',
    c: still([1, 1, 1, 1]),
    o: still(opacity),
    w: still(width),
    lc: 2,
    lj: 2,
    nm: 'stroke',
  };
}

/** Draws a stroked path on rather than fading it in — a line that is being written. */
function trim(end: Property, start: Property = still(0)): Record<string, unknown> {
  return { ty: 'tm', s: start, e: end, o: still(0), m: 1, nm: 'trim' };
}

function animation(
  name: string,
  size: number,
  frames: number,
  layers: unknown[],
): LottieAnimation {
  return {
    v: '5.9.0',
    fr: 60,
    ip: 0,
    op: frames,
    w: size,
    h: size,
    nm: name,
    ddd: 0,
    assets: [],
    layers,
  };
}

/* ------------------------------------------------------------------ the four marks */

const TAU = Math.PI * 2;
const PETALS = 8;

/**
 * The loader: a lotus with a slow wave travelling round its petals.
 *
 * Not a spinner. A spinner says "the machine is busy"; a flower opening and closing says "wait
 * a moment", which is the correct thing to say to somebody standing in a hall — and it is the
 * one piece of ornament the kiosk allows itself, so it may as well be the organisation's own.
 */
export function lotusBloom(): LottieAnimation {
  const frames = 180;
  const centre = 110;

  const petals = Array.from({ length: PETALS }, (_, index) => {
    const lag = (index / PETALS) * TAU;
    return shapeLayer(
      `petal-${index}`,
      index + 1,
      frames,
      {
        position: [centre, centre, 0],
        rotation: (360 / PETALS) * index,
        scale: sampled(frames, 12, (phase) => {
          const wave = Math.sin(TAU * phase - lag);
          return [94 + 10 * wave, 94 + 10 * wave, 100];
        }),
        opacity: sampled(frames, 12, (phase) => 62 + 30 * Math.sin(TAU * phase - lag)),
      },
      [ellipse([0, -34], [28, 68]), fill(index % 2 === 0 ? 100 : 74)],
    );
  });

  const heart = shapeLayer(
    'heart',
    PETALS + 1,
    frames,
    {
      position: [centre, centre, 0],
      scale: sampled(frames, 8, (phase) => {
        const pulse = 100 + 9 * Math.sin(TAU * phase);
        return [pulse, pulse, 100];
      }),
    },
    [ellipse([0, 0], [26, 26]), fill()],
  );

  return animation('lotus-bloom', centre * 2, frames, [...petals, heart]);
}

/**
 * A lamp flame, for the moment the kiosk is waiting on somebody else — a bank, a printer.
 *
 * Two sine terms at unrelated frequencies, which is the cheapest way to make a flicker look
 * like fire rather than like a pulse. Paired with the payment screen's "waiting" line.
 */
export function diyaFlame(): LottieAnimation {
  const frames = 150;
  const centre = 70;

  const glow = shapeLayer(
    'glow',
    1,
    frames,
    {
      position: [centre, centre + 6, 0],
      scale: sampled(frames, 15, (phase) => {
        const breath = 100 + 14 * Math.sin(TAU * phase);
        return [breath, breath, 100];
      }),
      opacity: sampled(frames, 15, (phase) => 22 + 12 * Math.sin(TAU * phase)),
    },
    [ellipse([0, 0], [72, 72]), fill()],
  );

  const flame = shapeLayer(
    'flame',
    2,
    frames,
    {
      position: [centre, centre + 14, 0],
      scale: sampled(frames, 20, (phase) => {
        const tall = 100 + 11 * Math.sin(TAU * phase) + 5 * Math.sin(TAU * 3 * phase);
        const wide = 100 - 5 * Math.sin(TAU * phase) + 3 * Math.sin(TAU * 5 * phase);
        return [wide, tall, 100];
      }),
    },
    [ellipse([0, -20], [26, 54]), fill()],
  );

  const wick = shapeLayer('wick', 3, frames, { position: [centre, centre + 16, 0] }, [
    ellipse([0, 0], [12, 12]),
    fill(70),
  ]);

  return animation('diya-flame', centre * 2, frames, [glow, flame, wick]);
}

/**
 * The confirmation: a ring drawn round a check that writes itself, with the petals of the
 * loader opening behind it. Plays once — a success that keeps looping stops being one.
 */
export function bloomCheck(): LottieAnimation {
  const frames = 96;
  const centre = 80;

  const burst = Array.from({ length: PETALS }, (_, index) =>
    shapeLayer(
      `spark-${index}`,
      index + 1,
      frames,
      {
        position: [centre, centre, 0],
        rotation: (360 / PETALS) * index,
        scale: keyed([
          { t: 0, v: [0, 0, 100] },
          { t: 34, v: [100, 100, 100] },
          { t: 96, v: [112, 112, 100] },
        ]),
        opacity: keyed([
          { t: 0, v: 0 },
          { t: 20, v: 60 },
          { t: 96, v: 0 },
        ]),
      },
      [ellipse([0, -46], [10, 22]), fill(80)],
    ),
  );

  const ring = shapeLayer(
    'ring',
    PETALS + 1,
    frames,
    { position: [centre, centre, 0] },
    [
      ellipse([0, 0], [96, 96]),
      stroke(6),
      trim(
        keyed([
          { t: 0, v: 0 },
          { t: 44, v: 100 },
        ]),
      ),
    ],
  );

  const tick = shapeLayer(
    'tick',
    PETALS + 2,
    frames,
    { position: [centre, centre, 0] },
    [
      polyline([
        [-21, 2],
        [-6, 17],
        [23, -15],
      ]),
      stroke(9),
      trim(
        keyed([
          { t: 22, v: 0 },
          { t: 58, v: 100 },
        ]),
      ),
    ],
  );

  return animation('bloom-check', centre * 2, frames, [...burst, ring, tick]);
}

/**
 * A scan line crossing a bracketed frame. Sits behind the UPI QR so a guest holding a phone
 * up to the screen can see that the code is live rather than a printed sticker.
 */
export function scanPulse(): LottieAnimation {
  const frames = 132;
  const centre = 90;

  const frame = shapeLayer('frame', 1, frames, { position: [centre, centre, 0] }, [
    roundedRect([0, 0], [148, 148], 22),
    stroke(4, 40),
  ]);

  const beam = shapeLayer(
    'beam',
    2,
    frames,
    {
      position: [centre, centre, 0],
      scale: still([100, 100, 100]),
      opacity: keyed([
        { t: 0, v: 0 },
        { t: 22, v: 88 },
        { t: 110, v: 88 },
        { t: 132, v: 0 },
      ]),
    },
    [
      {
        ty: 'rc',
        d: 1,
        p: {
          a: 1,
          k: [
            { t: 0, s: [0, -62], i: EASE_OUT, o: EASE_IN },
            { t: 66, s: [0, 62], i: EASE_OUT, o: EASE_IN },
            { t: 132, s: [0, -62], i: EASE_OUT, o: EASE_IN },
          ],
        },
        s: still([132, 4]),
        r: still(2),
        nm: 'beam-rect',
      },
      fill(),
    ],
  );

  return animation('scan-pulse', centre * 2, frames, [frame, beam]);
}

/**
 * The greeting mark: a lamp between two opening palms, rising as it is said.
 *
 * Shown behind whatever words the hall has chosen to greet guests with — "राधे राधे" at
 * Mangarh, something else elsewhere. The words are a setting; this is the gesture under them,
 * so a hall that changes its greeting does not need new artwork, and one that clears it
 * entirely simply loses a mark rather than being left with a caption for nothing.
 *
 * It breathes rather than loops visibly: two palms opening a little and closing a little, a
 * flame lifting between them. A greeting that animates hard reads as an advertisement, which
 * is the one thing this screen must not be.
 */
export function radheGreeting(): LottieAnimation {
  const frames = 210;
  const centre = 100;

  // Two palms, mirrored. Each is an ellipse rotated away from the vertical and swung a few
  // degrees over the cycle — enough to read as opening, not enough to read as clapping.
  const palms = [-1, 1].map((side, index) =>
    shapeLayer(
      `palm-${index}`,
      index + 1,
      frames,
      {
        position: [centre + side * 30, centre + 22, 0],
        rotation: side * 22,
        scale: sampled(frames, 14, (phase) => {
          const open = 100 + 5 * Math.sin(TAU * phase);
          return [open, open, 100];
        }),
        opacity: sampled(frames, 14, (phase) => 70 + 16 * Math.sin(TAU * phase)),
      },
      [ellipse([0, 0], [34, 62]), fill(index === 0 ? 88 : 72)],
    ),
  );

  const glow = shapeLayer(
    'greeting-glow',
    3,
    frames,
    {
      position: [centre, centre - 6, 0],
      scale: sampled(frames, 14, (phase) => {
        const breath = 100 + 16 * Math.sin(TAU * phase);
        return [breath, breath, 100];
      }),
      opacity: sampled(frames, 14, (phase) => 16 + 12 * Math.sin(TAU * phase)),
    },
    [ellipse([0, 0], [96, 96]), fill()],
  );

  // The flame lifts and settles on the same cycle as the palms, a quarter-turn behind them, so
  // the two never peak together — simultaneous peaks read as one pulsing blob.
  const flame = shapeLayer(
    'greeting-flame',
    4,
    frames,
    {
      position: [centre, centre - 4, 0],
      scale: sampled(frames, 18, (phase) => {
        const lift = Math.sin(TAU * phase - Math.PI / 2);
        return [100 - 4 * lift, 100 + 9 * lift, 100];
      }),
    },
    [ellipse([0, -14], [22, 46]), fill()],
  );

  const petals = Array.from({ length: 5 }, (_, index) =>
    shapeLayer(
      `greeting-petal-${index}`,
      index + 5,
      frames,
      {
        position: [centre, centre + 4, 0],
        rotation: -60 + index * 30,
        // Each petal drifts outward and fades, staggered round the cycle — the loop reads as a
        // continuous rising rather than as five things doing the same thing at once.
        scale: sampled(frames, 12, (phase) => {
          const drift = (phase + index / 5) % 1;
          const size = 40 + 70 * drift;
          return [size, size, 100];
        }),
        opacity: sampled(frames, 12, (phase) => {
          const drift = (phase + index / 5) % 1;
          return 46 * Math.sin(Math.PI * drift);
        }),
      },
      [ellipse([0, -58], [12, 26]), fill(70)],
    ),
  );

  return animation('radhe-greeting', centre * 2, frames, [glow, ...palms, flame, ...petals]);
}

export const LOTTIE = {
  lotus: lotusBloom,
  diya: diyaFlame,
  bloom: bloomCheck,
  scan: scanPulse,
  radhe: radheGreeting,
} as const;

export type LottieName = keyof typeof LOTTIE;
