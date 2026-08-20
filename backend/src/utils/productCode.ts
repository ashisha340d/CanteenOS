import { createHash } from 'node:crypto';
import type { Db } from '../db/types';
import { ingredientCategoryRepository } from '../repositories/IngredientRepository';
import { productRepository } from '../repositories/ProductRepository';

/**
 * Server-allocated product codes.
 *
 * A code is a six-digit number derived from the product's category and name, rather than a
 * plain incrementing counter. Two products entered a minute apart by two different operators
 * do not end up as neighbouring numbers with nothing in common — the digits are a function of
 * *this* product, so the same name in the same category always folds to the same code, and a
 * misread digit is more likely to be caught because the code is not arbitrary.
 *
 * It is not derived by truncating letters into digits (there is no reversible mapping from
 * "AJWAIN" to a six-digit number that stays six digits for every name); it is a hash of the
 * category and name, taken modulo one million. That is what "mixture formulation of name and
 * category" means here: the inputs are mixed together before the code is drawn, not that the
 * code spells anything out.
 */

const CODE_SPACE = 1_000_000;

/** Upper bound on collision retries. With ~1,000,000 codes and a few hundred products, a
 *  collision on the first attempt is already rare; failing after this many means something
 *  is wrong with the inputs, not that the address space is exhausted. */
export const PRODUCT_CODE_MAX_ATTEMPTS = 50;

/**
 * The deterministic candidate for a given `(category, name, salt)` triple.
 *
 * `salt` is what lets a caller ask for a *different* code for the same product without
 * abandoning the "derived from this product" property — attempt 1 is still a function of the
 * same category and name as attempt 0, just a different draw from the same hash family, so a
 * retried code is never an arbitrary random number typed nowhere else in the system.
 */
export function deriveProductCode(categoryName: string | null, name: string, salt = 0): string {
  const seed = `${(categoryName ?? '').trim().toUpperCase()}|${name.trim().toUpperCase()}|${salt}`;
  const digest = createHash('sha1').update(seed).digest();
  const value = digest.readUInt32BE(0) % CODE_SPACE;
  return String(value).padStart(6, '0');
}

/**
 * Allocate a free six-digit code for a product, checking every candidate against the live
 * table (which is checked across soft-deleted rows too — see `ProductRepository.findByCode` —
 * because the unique index does not know the difference).
 *
 * @param excludeId  the product's own id, when reallocating a code on an existing row, so it
 *                    does not refuse to reuse the code that is already its own.
 */
export async function allocateProductCode(
  db: Db,
  categoryId: string | null,
  name: string,
  excludeId?: string,
): Promise<string> {
  const category = categoryId === null ? null : await ingredientCategoryRepository.findById(db, categoryId);
  const categoryName = category?.name ?? null;

  for (let salt = 0; salt < PRODUCT_CODE_MAX_ATTEMPTS; salt += 1) {
    const candidate = deriveProductCode(categoryName, name, salt);
    const clash = await productRepository.findByCode(db, candidate);
    if (clash === null || clash.id === excludeId) return candidate;
  }

  throw new Error(
    `Could not allocate a unique product code for "${name}" after ${PRODUCT_CODE_MAX_ATTEMPTS} attempts`,
  );
}
