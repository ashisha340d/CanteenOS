/**
 * Proves the ingredient master now reads and writes `products` without changing behaviour.
 *
 * Exercises the real repository against the real database: list, insert, read back, update,
 * soft delete. Anything it creates it removes again, so it is safe to run on a dev database.
 *
 * Run with: npx tsx scripts/verify-ingredient-swap.mjs
 */
import { getPool } from '../src/db/pool';
import { ingredientRepository } from '../src/repositories/IngredientRepository';
import { mapIngredient } from '../src/models/mappers';
import { newId } from '../src/utils/ids';
import { mutate, selectOne } from '../src/db/types';

const pool = getPool();
const results = [];
const record = (name, pass, detail) => results.push({ name, pass, detail });

const probeId = newId();
const probeName = `__swap probe ${probeId.slice(0, 8)}`;

try {
  const listed = await ingredientRepository.list(pool, { limit: 5, offset: 0 });
  record('list returns migrated rows', listed.total > 0, `total=${listed.total}`);

  const mapped = listed.rows.length > 0 ? mapIngredient(listed.rows[0]) : null;
  record(
    'rows still map to the unchanged IngredientDto shape',
    mapped !== null &&
      typeof mapped.id === 'string' &&
      typeof mapped.name === 'string' &&
      typeof mapped.unit === 'string' &&
      'syncSeq' in mapped &&
      'revision' in mapped,
    mapped === null ? 'no rows' : `sample=${mapped.name}`,
  );

  const created = await ingredientRepository.insert(pool, {
    id: probeId,
    categoryId: null,
    name: probeName,
    nameHi: null,
    unit: 'KG',
    status: 'ACTIVE',
    sortOrder: 0,
    createdBy: null,
  });
  record('insert writes through to products', created.id === probeId, `id=${created.id}`);

  const landed = await selectOne(pool, 'SELECT id, kind, is_purchasable FROM products WHERE id = ?', [
    probeId,
  ]);
  record(
    'the row really is in products with purchase defaults applied',
    landed !== null && landed.kind === 'STOCK' && Number(landed.is_purchasable) === 1,
    landed === null ? 'absent' : `kind=${landed.kind}`,
  );

  const notInLegacy = await selectOne(pool, 'SELECT id FROM ingredients WHERE id = ?', [probeId]);
  record(
    'the legacy table is no longer written to',
    notInLegacy === null,
    notInLegacy === null ? 'clean' : 'legacy row created',
  );

  const updated = await ingredientRepository.update(pool, probeId, { unit: 'LTR' });
  record(
    'update bumps revision and changes the row',
    updated !== null && updated.unit === 'LTR' && updated.revision === 2,
    `unit=${updated?.unit} revision=${updated?.revision}`,
  );

  const beforeSeq = created.sync_seq;
  const afterSeq = updated?.sync_seq ?? 0;
  record(
    'sync cursor advances so the phone still sees the change',
    Number(afterSeq) > Number(beforeSeq),
    `${beforeSeq} -> ${afterSeq}`,
  );

  const deleted = await ingredientRepository.softDelete(pool, probeId);
  const gone = await ingredientRepository.findById(pool, probeId);
  record('soft delete hides the row', deleted && gone === null, `deleted=${deleted}`);
} finally {
  await mutate(pool, 'DELETE FROM products WHERE id = ?', [probeId]);
  await pool.end();
}

let failed = 0;
for (const { name, pass, detail } of results) {
  if (!pass) failed += 1;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
