/**
 * One-shot codemod: give every typography-derived text style an explicit `fontFamily`.
 *
 * React Native on Android cannot synthesise a weight from a custom font file, so the weight
 * *is* the family. A style that sets `fontSize: typography.body.size` + `fontWeight: '700'`
 * must resolve to `Inter_700Bold`, not to body's own regular family — which is why this is
 * weight-aware rather than a blind insert.
 *
 * Handles both multi-line style objects and single-line ones
 * (`roleText: { fontSize: typography.caption.size, fontWeight: '700' }`) — an earlier version
 * anchored the match to the start of a line and silently skipped every single-line style.
 *
 * Idempotent. Run from `app/`:  node scripts/apply-font-families.js
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['src', 'app'];
const TOKEN_WEIGHT = {
  headlineLg: '700', headlineMd: '600', bodyMd: '400', bodySm: '400',
  dataMono: '500', labelCaps: '700', display: '700', title1: '700',
  title2: '700', title3: '600', body: '400', callout: '500',
  caption: '700', footnote: '700',
};
const FAMILY_FOR_WEIGHT = {
  '400': 'fonts.sans', '500': 'fonts.sansMedium', '600': 'fonts.sansSemibold',
  '700': 'fonts.sansBold', '800': 'fonts.sansBold', '900': 'fonts.sansBold',
  bold: 'fonts.sansBold',
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Bounds of the innermost object literal containing `index`. */
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
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

function resolveFamily(step, objectBody) {
  if (step === 'dataMono') return 'fonts.mono';
  const explicit = objectBody.match(/\bfontWeight:\s*'([^']+)'/);
  if (explicit) return FAMILY_FOR_WEIGHT[explicit[1]] ?? 'fonts.sans';
  return FAMILY_FOR_WEIGHT[TOKEN_WEIGHT[step]] ?? 'fonts.sans';
}

let filesChanged = 0;
let sitesChanged = 0;

for (const root of ROOTS) {
  for (const file of walk(path.join(__dirname, '..', root))) {
    let text = fs.readFileSync(file, 'utf8');
    if (!text.includes('fontSize: typography.')) continue;
    const original = text;

    const pattern = /fontSize: typography\.(\w+)\.size,/g;
    const edits = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const step = match[1];
      const block = enclosingObject(text, match.index);
      if (block === null) continue;
      const body = text.slice(block.start, block.end + 1);
      if (/\bfontFamily:/.test(body)) continue; // already done

      const family = resolveFamily(step, body);

      // Match the surrounding formatting: own line if the property sits on its own line,
      // otherwise inline so single-line style objects stay single-line.
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const prefix = text.slice(lineStart, match.index);
      const ownLine = /^[ \t]*$/.test(prefix);
      const insert = ownLine
        ? `fontFamily: ${family},\n${prefix}`
        : `fontFamily: ${family}, `;

      edits.push({ at: match.index, insert });
    }

    if (edits.length === 0) continue;
    for (let i = edits.length - 1; i >= 0; i -= 1) {
      text = text.slice(0, edits[i].at) + edits[i].insert + text.slice(edits[i].at);
    }

    // Ensure `fonts` is imported alongside the existing token import.
    if (!/import \{[^}]*\bfonts\b[^}]*\} from '[^']*theme\/tokens'/.test(text)) {
      text = text.replace(
        /import \{([^}]*)\} from ('(?:\.\.\/)+(?:src\/)?theme\/tokens')/,
        (m, names, src) => `import {${names.replace(/\s+$/, '')}, fonts } from ${src}`,
      );
    }

    if (text !== original) {
      fs.writeFileSync(file, text);
      filesChanged += 1;
      sitesChanged += edits.length;
    }
  }
}

console.log(`Applied fontFamily at ${sitesChanged} site(s) across ${filesChanged} file(s).`);
