import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies non-TypeScript assets into dist. `tsc` only emits JavaScript, so the .sql migration
 * files would otherwise be missing from a production build and the server would refuse to start.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');

const ASSET_DIRECTORIES = [
  ['src/db/migrations', 'dist/db/migrations'],
  // seedRecipes.ts reads this JSON at runtime relative to __dirname; tsc only emits .js.
  ['src/db/seeds/data', 'dist/db/seeds/data'],
  // seedRealMenu.ts reads the menu cover image at runtime relative to __dirname.
  ['src/db/seeds/assets', 'dist/db/seeds/assets'],
];

for (const [from, to] of ASSET_DIRECTORIES) {
  const source = path.join(packageRoot, from);
  const destination = path.join(packageRoot, to);
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
  process.stdout.write(`copied ${from} -> ${to}\n`);
}
