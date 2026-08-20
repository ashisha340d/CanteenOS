/**
 * One-off data fix for the purchase product master, run once against the live database:
 *
 *   1. Every active product without a code gets one, drawn from `allocateProductCode` — the
 *      exact function the create/update endpoints now call, so a backfilled code and a
 *      freshly-typed one are indistinguishable.
 *   2. Every active product's name is normalised to Proper Case via `toProperCase` — the same
 *      function the service now applies on every save.
 *
 * Both operations go through the real repository/service layer rather than raw SQL, so sync
 * sequence numbers, `updated_at` and `revision` all advance exactly as they would for a normal
 * edit — a device that syncs afterwards sees ordinary update rows, not a schema anomaly.
 *
 * Idempotent: a product that already has a code and a Proper Case name is left untouched, so
 * this can be re-run safely.
 *
 * Run with: npx tsx scripts/backfill-product-codes.ts
 */
import { getPool } from '../src/db/pool';
import { withTransaction } from '../src/db/transaction';
import { productRepository } from '../src/repositories/ProductRepository';
import { allocateProductCode } from '../src/utils/productCode';
import { toProperCase } from '../src/utils/textCase';

async function main(): Promise<void> {
  const pool = getPool();

  const { rows } = await productRepository.list(pool, {
    limit: 1000,
    offset: 0,
    includeDeleted: false,
  });

  console.log(`Scanning ${rows.length} active products…\n`);

  let codesAssigned = 0;
  let namesFixed = 0;
  let unchanged = 0;

  for (const row of rows) {
    const properName = toProperCase(row.name);
    const needsName = properName !== row.name;
    const needsCode = row.code === null || row.code.trim() === '';

    if (!needsName && !needsCode) {
      unchanged += 1;
      continue;
    }

    await withTransaction(async (connection) => {
      const patch: { name?: string; code?: string } = {};
      if (needsName) patch.name = properName;
      if (needsCode) {
        patch.code = await allocateProductCode(
          connection,
          row.category_id,
          properName,
          row.id,
        );
      }
      await productRepository.update(connection, row.id, patch);
    });

    if (needsCode) codesAssigned += 1;
    if (needsName) namesFixed += 1;
    console.log(
      `  ${row.name.padEnd(28)} ${needsName ? `-> "${properName}" ` : ''}${
        needsCode ? '(code allocated)' : ''
      }`,
    );
  }

  console.log(`\nDone. ${codesAssigned} code(s) allocated, ${namesFixed} name(s) proper-cased, ${unchanged} already fine.`);
  await pool.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
