/**
 * Audits the result of apply-font-families.js.
 *
 * Independently re-derives the family every typography-derived style *should* carry and
 * compares it to what is actually there, so a wrong weight is caught as loudly as a missing
 * one. Run from `app/`:  node scripts/verify-font-families.js
 */
const fs = require('node:fs');
const path = require('node:path');

const WEIGHT_FAMILY = {
  '400': 'fonts.sans', '500': 'fonts.sansMedium', '600': 'fonts.sansSemibold',
  '700': 'fonts.sansBold', '800': 'fonts.sansBold', '900': 'fonts.sansBold',
  bold: 'fonts.sansBold',
};
const TOKEN_WEIGHT = {
  headlineLg: '700', headlineMd: '600', bodyMd: '400', bodySm: '400',
  dataMono: '500', labelCaps: '700', display: '700', title1: '700',
  title2: '700', title3: '600', body: '400', callout: '500',
  caption: '700', footnote: '700',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function enclosingObject(text, index) {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i -= 1) {
    if (text[i] === '}') depth += 1;
    else if (text[i] === '{') {
      if (depth === 0) { start = i; break; }
      depth -= 1;
    }
  }
  if (start === -1) return null;
  depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

let total = 0;
const missing = [];
const wrong = [];

for (const root of ['src', 'app']) {
  for (const file of walk(path.join(__dirname, '..', root))) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /fontSize: typography\.(\w+)\.size,/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      total += 1;
      const step = match[1];
      const body = enclosingObject(text, match.index);
      const rel = path.relative(path.join(__dirname, '..'), file);
      if (body === null || !/fontFamily:/.test(body)) {
        missing.push(`${rel} :: ${step}`);
        continue;
      }
      // A style may name the family directly (`fonts.sansBold`) or go through the token
      // (`typography.labelCaps.fontFamily`). Both are correct; normalise before comparing.
      const raw = (body.match(/fontFamily:\s*((?:fonts|typography)\.[\w.]+)/) || [])[1];
      const viaToken = raw && raw.match(/^typography\.(\w+)\.fontFamily$/);
      const actual = viaToken
        ? (WEIGHT_FAMILY[TOKEN_WEIGHT[viaToken[1]]] ?? 'fonts.sans')
        : raw;
      let expected;
      if (step === 'dataMono') {
        expected = 'fonts.mono';
      } else if (actual === 'fonts.mono') {
        // A deliberate monospaced value rendered at a non-mono size step, e.g. the archive's
        // "sum of items" figure at headline size. Intentional, not drift.
        expected = 'fonts.mono';
      } else {
        const explicit = body.match(/fontWeight:\s*'([^']+)'/);
        expected = explicit
          ? (WEIGHT_FAMILY[explicit[1]] ?? 'fonts.sans')
          : (WEIGHT_FAMILY[TOKEN_WEIGHT[step]] ?? 'fonts.sans');
      }
      if (actual !== expected) wrong.push(`${rel} :: ${step} got ${actual} want ${expected}`);
    }
  }
}

console.log(`typography sites scanned : ${total}`);
console.log(`missing fontFamily       : ${missing.length}`);
missing.slice(0, 15).forEach((m) => console.log(`   ${m}`));
console.log(`wrong family for weight  : ${wrong.length}`);
wrong.slice(0, 15).forEach((w) => console.log(`   ${w}`));
process.exitCode = missing.length + wrong.length > 0 ? 1 : 0;
