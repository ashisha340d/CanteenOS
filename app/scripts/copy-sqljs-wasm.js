/**
 * Copies sql.js's wasm binary into `public/`, where Expo's static middleware serves it at
 * `/sql-wasm.wasm` for the web development target (see src/db/sqliteDriver.web.ts).
 *
 * It runs from the `web` npm script rather than being committed once, so the binary can never
 * drift from the installed sql.js version after an upgrade or a fresh `npm install`.
 */
const fs = require('fs');
const path = require('path');

const source = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
const targetDir = path.join(__dirname, '..', 'public');
const target = path.join(targetDir, 'sql-wasm.wasm');

if (!fs.existsSync(source)) {
  console.error(`[copy-sqljs-wasm] ${source} is missing — run \`npm install\` first.`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });

// Skip the write when the bytes already match, so Metro's watcher isn't nudged on every start.
if (fs.existsSync(target) && fs.readFileSync(target).equals(fs.readFileSync(source))) {
  process.exit(0);
}

fs.copyFileSync(source, target);
console.log(`[copy-sqljs-wasm] refreshed public/sql-wasm.wasm`);
