/**
 * End-to-end verification for the purchase master API (`/api/v1/purchase`).
 *
 * Signs in over HTTP as a real ADMIN and then exercises every endpoint the slice added:
 * units, inventory locations, the product master with its joins and filters, per-location
 * stock policy, the supplier ↔ product mapping, and the vendor purchase profile. Every rule
 * that is easy to get wrong is asserted rather than assumed — duplicate codes conflict, a
 * stale revision is refused, "default" is exclusive, and a soft-deleted row stays gone.
 *
 * Everything it creates it removes again, and every profile it edits it puts back.
 *
 * Run against the dev server with: node scripts/verify-purchase-masters.mjs
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const BASE = process.env.VERIFY_BASE ?? `http://localhost:${process.env.PORT ?? 4000}`;
const API = `${BASE}/api/v1`;
const IDENTIFIER = process.env.VERIFY_USER ?? 'admin';
const PASSWORD = process.env.VERIFY_PASSWORD ?? 'MenuBoard@2026';
const DEVICE_ID = 'verify-purchase-masters';
const STAMP = Date.now().toString().slice(-8);

/** The capabilities this API is gated on. Granted to ADMIN if the matrix does not have them. */
const REQUIRED_CAPABILITIES = [
  'product.read',
  'product.write',
  'inventory.uom.manage',
  'inventory.location.manage',
  'purchase.supplier_product.manage',
  'inventory.read',
  'purchase.read',
  'entity.write',
];

let passed = 0;
let failed = 0;
let skipped = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` -> ${JSON.stringify(detail)}`}`);
  }
}

function skip(name, why) {
  skipped += 1;
  console.log(`  SKIP  ${name} (${why})`);
}

function section(title) {
  console.log(`\n${title}`);
}

let token = null;

async function call(method, path, body) {
  const headers = { 'x-client-type': 'ADMIN', 'x-device-id': DEVICE_ID };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = { parseError: text.slice(0, 400) };
  }
  return { status: response.status, body: json, data: json?.data, meta: json?.meta };
}

function dbConnection() {
  return mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER ?? 'root',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'menuboard',
  });
}

/** Ids of everything created, torn down in reverse order of dependency. */
const cleanup = {
  supplierProductId: null,
  productId: null,
  derivedUnitProductId: null,
  locationId: null,
  secondLocationId: null,
  uomId: null,
  createdVendorId: null,
  vendorId: null,
  vendorProfileBefore: null,
  restoreDefaultReceivingId: null,
};

async function main() {
  /* ------------------------------------------------------------------ login */

  section('Authentication');
  const login = await call('POST', '/auth/login', {
    identifier: IDENTIFIER,
    password: PASSWORD,
    deviceId: DEVICE_ID,
    clientType: 'ADMIN',
  });
  check('signs in as ADMIN over HTTP', login.status === 200, login.body);
  token = login.data?.tokens?.accessToken ?? null;
  check('receives an access token', typeof token === 'string' && token.length > 0);
  if (token === null) return;

  // The purchase capabilities are new; the live matrix in `role_capabilities` predates them.
  // Grant whatever is missing to ADMIN through the documented admin endpoint — this is the
  // same call the Permissions page makes, and the grants are the intended end state.
  const held = new Set(login.body?.data?.capabilities ?? []);
  const missing = REQUIRED_CAPABILITIES.filter((capability) => !held.has(capability));
  for (const capability of missing) {
    const granted = await call('PATCH', `/admin/permissions/role/ADMIN/${capability}`, {
      granted: true,
    });
    check(`grants ${capability} to ADMIN`, granted.status === 204, {
      status: granted.status,
      body: granted.body,
    });
  }
  if (missing.length === 0) console.log('  NOTE  every purchase capability was already granted');
  else console.log(`  NOTE  granted ${missing.length} purchase capability grant(s) to ADMIN`);

  const matrix = await call('GET', '/admin/permissions');
  const adminHolds = new Set(matrix.data?.roleCapabilities?.ADMIN ?? []);
  check(
    'ADMIN holds every capability this API is gated on',
    REQUIRED_CAPABILITIES.every((capability) => adminHolds.has(capability)),
    REQUIRED_CAPABILITIES.filter((capability) => !adminHolds.has(capability)),
  );

  /* ----------------------------------------------------- reference data */

  section('Reference data');
  const categories = await call('GET', '/ingredient-categories?pageSize=1');
  const categoryId = categories.data?.[0]?.id ?? null;
  check('reads an ingredient category to file the product under', categories.status === 200, categories.body);

  const taxProfiles = await call('GET', '/tax-profiles?pageSize=1');
  const taxProfile = taxProfiles.data?.[0] ?? null;
  check('reads a tax profile', taxProfiles.status === 200, taxProfiles.body);

  const hsn = await call('GET', '/hsn-sac?pageSize=1');
  const hsnSac = hsn.data?.[0] ?? null;
  check('reads the HSN/SAC master', hsn.status === 200, hsn.body);

  /* -------------------------------------------------------- GET /uoms */

  section('GET /purchase/uoms');
  const uomList = await call('GET', '/purchase/uoms?pageSize=100');
  check('lists units', uomList.status === 200, uomList.body);
  check('paginates', typeof uomList.meta?.total === 'number' && uomList.meta.total >= 13, uomList.meta);
  const kg = uomList.data?.find((u) => u.code === 'KG') ?? null;
  check('the seeded KG unit is present and mapped', kg !== null && kg.factorToBase === 1000 && kg.dimension === 'WEIGHT', kg);

  const byDimension = await call('GET', '/purchase/uoms?dimension=VOLUME&status=ACTIVE');
  check(
    'filters units by dimension',
    byDimension.status === 200 && byDimension.data.every((u) => u.dimension === 'VOLUME'),
    byDimension.data?.map((u) => u.code),
  );

  /* ------------------------------------------------------- POST /uoms */

  section('POST /purchase/uoms');
  const uomCode = `VC${STAMP}`;
  const createdUom = await call('POST', '/purchase/uoms', {
    code: uomCode.toLowerCase(),
    name: `Verify Carton ${STAMP}`,
    dimension: 'PACK',
    factorToBase: 1,
    decimalPlaces: 0,
    sortOrder: 900,
  });
  check('creates a unit', createdUom.status === 201, createdUom.body);
  cleanup.uomId = createdUom.data?.id ?? null;
  check('normalises the code to upper case', createdUom.data?.code === uomCode, createdUom.data?.code);

  const dupUom = await call('POST', '/purchase/uoms', {
    code: uomCode,
    name: 'Duplicate',
    dimension: 'PACK',
  });
  check('refuses a duplicate unit code with 409', dupUom.status === 409, dupUom.body);

  const badFactor = await call('POST', '/purchase/uoms', {
    code: `VZ${STAMP}`,
    name: 'Bad factor',
    dimension: 'PACK',
    factorToBase: 0,
  });
  check('refuses a zero conversion factor with 400', badFactor.status === 400, badFactor.body);

  /* ------------------------------------------------------ PATCH /uoms */

  section('PATCH /purchase/uoms/:uomId');
  const patchedUom = await call('PATCH', `/purchase/uoms/${cleanup.uomId}`, {
    name: `Verify Carton ${STAMP} (renamed)`,
    sortOrder: 950,
  });
  check('updates a unit', patchedUom.status === 200, patchedUom.body);
  check('applies the change', patchedUom.data?.name?.endsWith('(renamed)') === true, patchedUom.data?.name);

  /* --------------------------------------------------- GET /locations */

  section('GET /purchase/locations');
  const locationList = await call('GET', '/purchase/locations?pageSize=100');
  check('lists inventory locations', locationList.status === 200, locationList.body);
  const seededDefault = locationList.data?.find((l) => l.isDefaultReceiving === true) ?? null;
  check('exactly one location is the receiving default',
    locationList.data?.filter((l) => l.isDefaultReceiving === true).length === 1,
    locationList.data?.filter((l) => l.isDefaultReceiving === true).map((l) => l.code));
  cleanup.restoreDefaultReceivingId = seededDefault?.id ?? null;

  const byKind = await call('GET', '/purchase/locations?kind=WAREHOUSE');
  check(
    'filters locations by kind',
    byKind.status === 200 && byKind.data.every((l) => l.kind === 'WAREHOUSE'),
    byKind.data?.map((l) => l.code),
  );

  /* -------------------------------------------------- POST /locations */

  section('POST /purchase/locations');
  const createdLocation = await call('POST', '/purchase/locations', {
    code: `VLOC-${STAMP}`,
    name: `Verify Store ${STAMP}`,
    kind: 'DAY_STORE',
    allowsNegativeStock: true,
    isDefaultReceiving: true,
    sortOrder: 900,
    notes: 'Created by verify-purchase-masters',
  });
  check('creates an inventory location', createdLocation.status === 201, createdLocation.body);
  cleanup.locationId = createdLocation.data?.id ?? null;
  check('starts at revision 1', createdLocation.data?.revision === 1, createdLocation.data?.revision);
  check('takes the receiving default', createdLocation.data?.isDefaultReceiving === true, createdLocation.data);

  const afterDefaultMove = await call('GET', '/purchase/locations?pageSize=100');
  check(
    'setting a new default stood the incumbent down — still exactly one',
    afterDefaultMove.data?.filter((l) => l.isDefaultReceiving === true).length === 1 &&
    afterDefaultMove.data?.find((l) => l.isDefaultReceiving === true)?.id === cleanup.locationId,
    afterDefaultMove.data?.filter((l) => l.isDefaultReceiving === true).map((l) => l.code),
  );

  const dupLocation = await call('POST', '/purchase/locations', {
    code: `VLOC-${STAMP}`,
    name: 'Duplicate',
    kind: 'OTHER',
  });
  check('refuses a duplicate location code with 409', dupLocation.status === 409, dupLocation.body);

  const secondLocation = await call('POST', '/purchase/locations', {
    code: `VLOC2-${STAMP}`,
    name: `Verify Kitchen ${STAMP}`,
    kind: 'KITCHEN',
    sortOrder: 901,
  });
  check('creates a second location for the policy test', secondLocation.status === 201, secondLocation.body);
  cleanup.secondLocationId = secondLocation.data?.id ?? null;

  /* --------------------------------------- GET/PATCH /locations/:locationId */

  section('GET & PATCH /purchase/locations/:locationId');
  const readLocation = await call('GET', `/purchase/locations/${cleanup.locationId}`);
  check('reads one location', readLocation.status === 200 && readLocation.data?.id === cleanup.locationId, readLocation.body);
  check('allowsNegativeStock survives the round trip', readLocation.data?.allowsNegativeStock === true, readLocation.data);

  const staleLocation = await call('PATCH', `/purchase/locations/${cleanup.locationId}`, {
    name: 'Should be refused',
    expectedRevision: 99,
  });
  check('refuses a stale revision with 409', staleLocation.status === 409, staleLocation.body);
  check('reports STALE_WRITE', staleLocation.body?.error?.code === 'STALE_WRITE', staleLocation.body?.error);

  const patchedLocation = await call('PATCH', `/purchase/locations/${cleanup.locationId}`, {
    department: 'Verification',
    expectedRevision: readLocation.data?.revision,
  });
  check('updates with the current revision', patchedLocation.status === 200, patchedLocation.body);
  check('bumps the revision', patchedLocation.data?.revision === readLocation.data?.revision + 1, patchedLocation.data?.revision);

  const missingLocation = await call('GET', '/purchase/locations/00000000-0000-4000-8000-000000000000');
  check('an unknown location is 404', missingLocation.status === 404, missingLocation.body);

  /* ------------------------------------------------------------ vendor */

  section('Vendor entity');
  const vendors = await call('GET', '/purchase/vendors?pageSize=5');
  check('lists vendors', vendors.status === 200, vendors.body);
  if ((vendors.data?.length ?? 0) === 0) {
    const madeVendor = await call('POST', '/entities', {
      type: 'VENDOR',
      name: `Verify Vendor ${STAMP}`,
      phone: `9${STAMP}0`.slice(0, 10),
    });
    check('creates a VENDOR entity because none existed', madeVendor.status === 201, madeVendor.body);
    cleanup.createdVendorId = madeVendor.data?.id ?? null;
    cleanup.vendorId = madeVendor.data?.id ?? null;
  } else {
    cleanup.vendorId = vendors.data[0].id;
    console.log(`  NOTE  using the existing vendor ${vendors.data[0].code}`);
  }

  /* -------------------------------------------------------- POST /products */

  section('POST /purchase/products');
  const productBody = {
    name: `Verify Product ${STAMP}`,
    nameHi: 'सत्यापन उत्पाद',
    code: `VP-${STAMP}`,
    barcode: `890${STAMP}`,
    brand: 'VerifyBrand',
    description: 'Created by verify-purchase-masters',
    kind: 'STOCK',
    ...(categoryId !== null ? { categoryId } : {}),
    ...(taxProfile !== null ? { taxProfileId: taxProfile.id } : {}),
    ...(hsnSac !== null ? { hsnSacId: hsnSac.id } : {}),
    stockUomId: kg?.id ?? null,
    purchaseUomId: cleanup.uomId,
    purchaseConversionFactor: 12,
    packSize: '12 x 1 KG',
    isBatchTracked: true,
    isExpiryTracked: true,
    shelfLifeDays: 180,
    batchIssuePolicy: 'FEFO',
    valuationMethod: 'MOVING_AVERAGE',
    standardCost: 42.5,
    defaultLocationId: cleanup.locationId,
    preferredSupplierId: cleanup.vendorId,
    minStock: 10,
    reorderLevel: 25,
    maxStock: 200,
    leadTimeDays: 3,
    isPurchasable: true,
    isStocked: true,
    sortOrder: 900,
  };
  const createdProduct = await call('POST', '/purchase/products', productBody);
  check('creates a product', createdProduct.status === 201, createdProduct.body);
  cleanup.productId = createdProduct.data?.id ?? null;
  check('derives the display unit from the stock UOM', createdProduct.data?.unit === 'KG', createdProduct.data?.unit);
  check('keeps batch policy', createdProduct.data?.isBatchTracked === true && createdProduct.data?.batchIssuePolicy === 'FEFO', createdProduct.data);
  check('keeps the reorder levels as numbers', createdProduct.data?.reorderLevel === 25 && createdProduct.data?.maxStock === 200, {
    reorderLevel: createdProduct.data?.reorderLevel,
    maxStock: createdProduct.data?.maxStock,
  });
  check('keeps the purchase conversion factor', createdProduct.data?.purchaseConversionFactor === 12, createdProduct.data?.purchaseConversionFactor);
  check('carries sync metadata', typeof createdProduct.data?.syncSeq === 'number' && createdProduct.data.syncSeq > 0, createdProduct.data?.syncSeq);

  const dupName = await call('POST', '/purchase/products', { name: productBody.name });
  check('refuses a duplicate product name with 409', dupName.status === 409, dupName.body);

  const dupCode = await call('POST', '/purchase/products', {
    name: `Verify Product Other ${STAMP}`,
    code: productBody.code,
  });
  check('refuses a duplicate product code with 409', dupCode.status === 409, dupCode.body);

  const badLevels = await call('POST', '/purchase/products', {
    name: `Verify Product Levels ${STAMP}`,
    minStock: 100,
    maxStock: 10,
  });
  check('refuses a maximum below the minimum with 400', badLevels.status === 400, badLevels.body);

  const derivedUnit = await call('POST', '/purchase/products', {
    name: `Verify Derived Unit ${STAMP}`,
    stockUomId: kg?.id ?? null,
  });
  check('a product created with only a stock UOM still gets a unit', derivedUnit.data?.unit === 'KG', derivedUnit.data?.unit);
  cleanup.derivedUnitProductId = derivedUnit.data?.id ?? null;

  /* --------------------------------------------- GET /products/:productId */

  section('GET /purchase/products/:productId — joins');
  const readProduct = await call('GET', `/purchase/products/${cleanup.productId}`);
  check('reads one product', readProduct.status === 200, readProduct.body);
  const p = readProduct.data ?? {};
  check('joins stockUomCode', p.stockUomCode === 'KG', p.stockUomCode);
  check('joins purchaseUomCode', p.purchaseUomCode === uomCode, p.purchaseUomCode);
  check('joins defaultLocationName', p.defaultLocationName === `Verify Store ${STAMP}`, p.defaultLocationName);
  check('joins preferredSupplierName', typeof p.preferredSupplierName === 'string' && p.preferredSupplierName.length > 0, p.preferredSupplierName);
  if (categoryId !== null) check('joins categoryName', typeof p.categoryName === 'string' && p.categoryName.length > 0, p.categoryName);
  else skip('joins categoryName', 'no ingredient category exists');
  if (taxProfile !== null) {
    check('joins taxProfileName', p.taxProfileName === taxProfile.name, p.taxProfileName);
    check('joins taxRate as a number', typeof p.taxRate === 'number', p.taxRate);
  } else skip('joins taxProfileName / taxRate', 'no tax profile exists');
  if (hsnSac !== null) check('joins hsnSacCode', p.hsnSacCode === hsnSac.code, p.hsnSacCode);
  else skip('joins hsnSacCode', 'the HSN/SAC master is empty');

  /* ------------------------------------------------- GET /products filters */

  section('GET /purchase/products — filters');
  const contains = (result) => (result.data ?? []).some((row) => row.id === cleanup.productId);

  const searched = await call('GET', `/purchase/products?search=${encodeURIComponent(`Verify Product ${STAMP}`)}`);
  check('search matches the name', searched.status === 200 && contains(searched), searched.data?.length);

  const byBarcode = await call('GET', `/purchase/products?search=890${STAMP}`);
  check('search matches the barcode', contains(byBarcode), byBarcode.data?.length);

  const byBrand = await call('GET', '/purchase/products?search=VerifyBrand&pageSize=50');
  check('search matches the brand', contains(byBrand), byBrand.data?.length);

  const byCode = await call('GET', `/purchase/products?search=VP-${STAMP}`);
  check('search matches the code', contains(byCode), byCode.data?.length);

  const filtered = await call(
    'GET',
    `/purchase/products?kind=STOCK&status=ACTIVE&purchasableOnly=true&stockedOnly=true&batchTrackedOnly=true&search=${encodeURIComponent(productBody.name)}`,
  );
  check('kind + status + purchasable + stocked + batch-tracked all hold together', contains(filtered), filtered.data?.length);

  if (categoryId !== null) {
    const byCategory = await call('GET', `/purchase/products?categoryId=${categoryId}&search=${encodeURIComponent(productBody.name)}`);
    check('filters by category', contains(byCategory), byCategory.data?.length);
  } else skip('filters by category', 'no ingredient category exists');

  const notBatchTracked = await call('GET', `/purchase/products?batchTrackedOnly=true&search=${encodeURIComponent(`Verify Derived Unit ${STAMP}`)}`);
  check('batchTrackedOnly excludes an untracked product', (notBatchTracked.data ?? []).length === 0, notBatchTracked.data?.length);

  const belowReorder = await call('GET', `/purchase/products?belowReorderLevel=true&search=${encodeURIComponent(productBody.name)}`);
  check('belowReorderLevel finds a product with a level set', contains(belowReorder), belowReorder.data?.length);

  const withStock = await call('GET', `/purchase/products?includeStock=true&search=${encodeURIComponent(productBody.name)}`);
  // A genuine zero now, not a placeholder: the stock ledger exists and this freshly created
  // product has simply never been received anywhere.
  check('includeStock reports a real 0 for a product that holds no stock', withStock.data?.[0]?.stockOnHand === 0, withStock.data?.[0]?.stockOnHand);

  const byLocation = await call('GET', `/purchase/products?locationId=${cleanup.locationId}`);
  check('locationId filters to products with policy there (none yet)', (byLocation.data ?? []).length === 0, byLocation.data?.length);

  /* ------------------------------------------------ PATCH /products/:id */

  section('PATCH /purchase/products/:productId');
  const staleProduct = await call('PATCH', `/purchase/products/${cleanup.productId}`, {
    brand: 'Should be refused',
    expectedRevision: 99,
  });
  check('refuses a stale product revision with 409', staleProduct.status === 409, staleProduct.body);

  const patchedProduct = await call('PATCH', `/purchase/products/${cleanup.productId}`, {
    brand: 'VerifyBrand2',
    reorderLevel: 30,
    expectedRevision: readProduct.data?.revision,
  });
  check('updates a product with the current revision', patchedProduct.status === 200, patchedProduct.body);
  check('applies the change and bumps the revision',
    patchedProduct.data?.brand === 'VerifyBrand2' && patchedProduct.data?.revision === readProduct.data.revision + 1,
    { brand: patchedProduct.data?.brand, revision: patchedProduct.data?.revision });

  const badMaxPatch = await call('PATCH', `/purchase/products/${cleanup.productId}`, { maxStock: 5 });
  check('a patch that drops the maximum below the stored minimum is refused', badMaxPatch.status === 400, badMaxPatch.body);

  /* ------------------------------------- PUT /products/:id/locations */

  section('Product location policy');
  const upsertLocation = await call('PUT', `/purchase/products/${cleanup.productId}/locations`, {
    locationId: cleanup.locationId,
    minStock: 5,
    reorderLevel: 12,
    maxStock: 60,
    isDefaultDestination: true,
    bin: 'A-01',
  });
  check('upserts stock policy at a location', upsertLocation.status === 200, upsertLocation.body);
  check('joins the location name and kind',
    upsertLocation.data?.locationName === `Verify Store ${STAMP}` && upsertLocation.data?.locationKind === 'DAY_STORE',
    upsertLocation.data);
  check('marks it the default destination', upsertLocation.data?.isDefaultDestination === true, upsertLocation.data);

  const reUpsert = await call('PUT', `/purchase/products/${cleanup.productId}/locations`, {
    locationId: cleanup.locationId,
    reorderLevel: 15,
    isDefaultDestination: true,
    bin: 'A-02',
  });
  check('a second upsert updates rather than duplicating', reUpsert.status === 200 && reUpsert.data?.id === upsertLocation.data?.id, {
    first: upsertLocation.data?.id,
    second: reUpsert.data?.id,
  });
  check('the update took', reUpsert.data?.reorderLevel === 15 && reUpsert.data?.bin === 'A-02', reUpsert.data);

  const secondPolicy = await call('PUT', `/purchase/products/${cleanup.productId}/locations`, {
    productId: cleanup.productId,
    locationId: cleanup.secondLocationId,
    reorderLevel: 8,
    isDefaultDestination: true,
  });
  check('adds policy at a second location', secondPolicy.status === 200, secondPolicy.body);

  const policies = await call('GET', `/purchase/products/${cleanup.productId}/locations`);
  check('lists both policies', policies.status === 200 && policies.data?.length === 2, policies.data?.length);
  check('only one is the default destination',
    policies.data?.filter((row) => row.isDefaultDestination === true).length === 1 &&
    policies.data?.find((row) => row.isDefaultDestination === true)?.locationId === cleanup.secondLocationId,
    policies.data?.map((row) => ({ locationId: row.locationId, isDefault: row.isDefaultDestination })));

  const mismatched = await call('PUT', `/purchase/products/${cleanup.productId}/locations`, {
    productId: cleanup.secondLocationId,
    locationId: cleanup.locationId,
  });
  check('a body product that disagrees with the path is refused', mismatched.status === 400, mismatched.body);

  const nowFilteredByLocation = await call('GET', `/purchase/products?locationId=${cleanup.locationId}`);
  check('locationId now finds the product', (nowFilteredByLocation.data ?? []).some((row) => row.id === cleanup.productId), nowFilteredByLocation.data?.length);

  const deletedPolicy = await call('DELETE', `/purchase/products/${cleanup.productId}/locations/${cleanup.secondLocationId}`);
  check('deletes one policy', deletedPolicy.status === 204, deletedPolicy.body);
  const policiesAfter = await call('GET', `/purchase/products/${cleanup.productId}/locations`);
  check('the deleted policy is gone', policiesAfter.data?.length === 1, policiesAfter.data?.length);
  const deleteAgain = await call('DELETE', `/purchase/products/${cleanup.productId}/locations/${cleanup.secondLocationId}`);
  check('deleting it twice is 404', deleteAgain.status === 404, deleteAgain.body);

  /* ------------------------------------------------- supplier products */

  section('Supplier ↔ product mapping');
  const supplierSku = `SKU-${STAMP}`;
  const createdMapping = await call('POST', '/purchase/supplier-products', {
    supplierId: cleanup.vendorId,
    productId: cleanup.productId,
    supplierSku,
    supplierProductName: `Vendor's name for ${STAMP}`,
    barcode: `891${STAMP}`,
    purchaseUomId: cleanup.uomId,
    conversionFactor: 12,
    packSize: '12 x 1 KG',
    leadTimeDays: 2,
    isPreferred: true,
    notes: 'Created by verify-purchase-masters',
  });
  check('creates a supplier product mapping', createdMapping.status === 201, createdMapping.body);
  cleanup.supplierProductId = createdMapping.data?.id ?? null;
  check('joins the supplier, product and unit',
    typeof createdMapping.data?.supplierName === 'string' &&
    createdMapping.data?.productName === productBody.name &&
    createdMapping.data?.purchaseUomCode === uomCode,
    createdMapping.data);
  check('marks it preferred', createdMapping.data?.isPreferred === true, createdMapping.data?.isPreferred);

  const reUpsertMapping = await call('POST', '/purchase/supplier-products', {
    supplierId: cleanup.vendorId,
    productId: cleanup.productId,
    supplierSku,
    conversionFactor: 24,
    isPreferred: true,
  });
  check('re-posting the same pairing upserts rather than conflicting', reUpsertMapping.status === 200, reUpsertMapping.body);
  check('and lands on the same row', reUpsertMapping.data?.id === cleanup.supplierProductId, {
    first: cleanup.supplierProductId,
    second: reUpsertMapping.data?.id,
  });
  check('with the new conversion factor', reUpsertMapping.data?.conversionFactor === 24, reUpsertMapping.data?.conversionFactor);

  const skuClash = await call('POST', '/purchase/supplier-products', {
    supplierId: cleanup.vendorId,
    productId: cleanup.derivedUnitProductId,
    supplierSku,
  });
  check('the same SKU on another product for one supplier is 409', skuClash.status === 409, skuClash.body);

  const notAVendor = await call('POST', '/purchase/supplier-products', {
    supplierId: '00000000-0000-4000-8000-000000000000',
    productId: cleanup.productId,
  });
  check('a supplier that is not a VENDOR entity is refused', notAVendor.status === 400, notAVendor.body);

  const badConversion = await call('POST', '/purchase/supplier-products', {
    supplierId: cleanup.vendorId,
    productId: cleanup.derivedUnitProductId,
    conversionFactor: 0,
  });
  check('a zero conversion factor is refused', badConversion.status === 400, badConversion.body);

  const patchedMapping = await call('PATCH', `/purchase/supplier-products/${cleanup.supplierProductId}`, {
    supplierId: cleanup.vendorId,
    productId: cleanup.productId,
    leadTimeDays: 5,
    notes: 'Patched by verify-purchase-masters',
  });
  check('patches a mapping, restating the pairing it already has', patchedMapping.status === 200 && patchedMapping.data?.leadTimeDays === 5, patchedMapping.body);

  const rePointed = await call('PATCH', `/purchase/supplier-products/${cleanup.supplierProductId}`, {
    productId: cleanup.derivedUnitProductId,
  });
  check('but a patch that re-points it at another product is refused', rePointed.status === 400, rePointed.body);

  const mappingList = await call('GET', `/purchase/supplier-products?productId=${cleanup.productId}&preferredOnly=true`);
  check('lists mappings filtered by product and preference',
    mappingList.status === 200 && mappingList.data?.length === 1 && mappingList.data[0].id === cleanup.supplierProductId,
    mappingList.data?.map((row) => row.id));

  const bySupplier = await call('GET', `/purchase/supplier-products?supplierId=${cleanup.vendorId}&pageSize=100`);
  check('lists mappings filtered by supplier',
    bySupplier.status === 200 && bySupplier.data.some((row) => row.id === cleanup.supplierProductId),
    bySupplier.data?.length);

  const productsBySupplier = await call('GET', `/purchase/products?supplierId=${cleanup.vendorId}&pageSize=100`);
  check('the product list can be filtered by supplier',
    (productsBySupplier.data ?? []).some((row) => row.id === cleanup.productId),
    productsBySupplier.data?.length);

  /* ---------------------------------------------------------- vendors */

  section('Vendors');
  const vendorList = await call('GET', '/purchase/vendors?pageSize=10');
  check('lists vendors with their profile', vendorList.status === 200 && vendorList.data.every((v) => v.profile !== undefined), vendorList.data?.[0]);
  check('omits `outstanding` rather than faking a zero',
    vendorList.data.every((v) => !Object.prototype.hasOwnProperty.call(v, 'outstanding')),
    Object.keys(vendorList.data?.[0] ?? {}));

  const oneVendor = await call('GET', `/purchase/vendors/${cleanup.vendorId}`);
  check('reads one vendor', oneVendor.status === 200 && oneVendor.data?.id === cleanup.vendorId, oneVendor.body);
  check('the profile carries the vendor_* columns',
    typeof oneVendor.data?.profile?.creditDays === 'number' &&
    typeof oneVendor.data?.profile?.isApproved === 'boolean' &&
    oneVendor.data?.profile?.entityId === cleanup.vendorId,
    oneVendor.data?.profile);
  cleanup.vendorProfileBefore = oneVendor.data?.profile ?? null;

  const notAVendorRead = await call('GET', '/purchase/vendors/00000000-0000-4000-8000-000000000000');
  check('an unknown vendor is 404', notAVendorRead.status === 404, notAVendorRead.body);

  const patchedVendor = await call('PATCH', `/purchase/vendors/${cleanup.vendorId}/profile`, {
    paymentTerms: 'Net 30 (verify)',
    creditDays: 30,
    bankName: 'Verify Bank',
    bankAccount: '000123456789',
    bankIfsc: 'HDFC0001234',
    openingBalance: 1500.5,
    isApproved: false,
    defaultLocationId: cleanup.locationId,
  });
  check('patches the vendor purchase profile', patchedVendor.status === 200, patchedVendor.body);
  check('every profile field round-trips',
    patchedVendor.data?.profile?.paymentTerms === 'Net 30 (verify)' &&
    patchedVendor.data?.profile?.creditDays === 30 &&
    patchedVendor.data?.profile?.bankIfsc === 'HDFC0001234' &&
    patchedVendor.data?.profile?.openingBalance === 1500.5 &&
    patchedVendor.data?.profile?.isApproved === false &&
    patchedVendor.data?.profile?.defaultLocationId === cleanup.locationId,
    patchedVendor.data?.profile);

  const badIfsc = await call('PATCH', `/purchase/vendors/${cleanup.vendorId}/profile`, { bankIfsc: 'NOPE' });
  check('a malformed IFSC is refused', badIfsc.status === 400, badIfsc.body);

  /* -------------------------------------------------- deletion guards */

  section('Deletion guards');
  const uomInUse = await call('DELETE', `/purchase/uoms/${cleanup.uomId}`);
  check('a unit a product still uses cannot be deleted', uomInUse.status === 409, uomInUse.body);

  const locationInUse = await call('DELETE', `/purchase/locations/${cleanup.locationId}`);
  check('a location a product still points at cannot be deleted', locationInUse.status === 409, locationInUse.body);

  const connection = await dbConnection();
  let recipeProductId = null;
  try {
    const [rows] = await connection.query(
      `SELECT ri.ingredient_id AS id FROM recipe_ingredients ri
         JOIN products p ON p.id = ri.ingredient_id AND p.deleted_at IS NULL
        WHERE ri.deleted_at IS NULL LIMIT 1`,
    );
    recipeProductId = rows[0]?.id ?? null;
  } finally {
    await connection.end();
  }
  if (recipeProductId === null) skip('a product used by a recipe cannot be deleted', 'no recipe line exists');
  else {
    const refused = await call('DELETE', `/purchase/products/${recipeProductId}`);
    check('a product used by a recipe cannot be deleted', refused.status === 409, refused.body);
    const stillThere = await call('GET', `/purchase/products/${recipeProductId}`);
    check('and it is still there afterwards', stillThere.status === 200, stillThere.status);
  }
}

async function teardown() {
  section('Cleanup');

  if (cleanup.supplierProductId !== null) {
    const result = await call('DELETE', `/purchase/supplier-products/${cleanup.supplierProductId}`);
    check('removes the supplier mapping', result.status === 204, result.body);
    const gone = await call('GET', `/purchase/supplier-products?productId=${cleanup.productId}`);
    check('the mapping no longer lists', (gone.data ?? []).length === 0, gone.data?.length);
  }

  if (cleanup.productId !== null) {
    const policy = await call('DELETE', `/purchase/products/${cleanup.productId}/locations/${cleanup.locationId}`);
    check('removes the remaining stock policy', policy.status === 204, policy.body);

    const result = await call('DELETE', `/purchase/products/${cleanup.productId}`);
    check('removes the product', result.status === 204, result.body);
    const gone = await call('GET', `/purchase/products/${cleanup.productId}`);
    check('the product is soft-deleted and no longer readable', gone.status === 404, gone.status);
  }

  if (cleanup.derivedUnitProductId !== null) {
    const result = await call('DELETE', `/purchase/products/${cleanup.derivedUnitProductId}`);
    check('removes the second product', result.status === 204, result.body);
  }

  if (cleanup.secondLocationId !== null) {
    const result = await call('DELETE', `/purchase/locations/${cleanup.secondLocationId}`);
    check('removes the second location', result.status === 204, result.body);
  }

  if (cleanup.locationId !== null) {
    const result = await call('DELETE', `/purchase/locations/${cleanup.locationId}`);
    check('removes the location once nothing references it', result.status === 204, result.body);
  }

  if (cleanup.uomId !== null) {
    const result = await call('DELETE', `/purchase/uoms/${cleanup.uomId}`);
    check('removes the unit once nothing references it', result.status === 204, result.body);
  }

  // Put the receiving default back where it was before this run moved it.
  if (cleanup.restoreDefaultReceivingId !== null) {
    const result = await call('PATCH', `/purchase/locations/${cleanup.restoreDefaultReceivingId}`, {
      isDefaultReceiving: true,
    });
    check('restores the original default receiving location', result.status === 200 && result.data?.isDefaultReceiving === true, result.body);
  }

  if (cleanup.createdVendorId !== null) {
    const result = await call('DELETE', `/entities/${cleanup.createdVendorId}`);
    check('removes the vendor it created', result.status === 204, result.body);
  } else if (cleanup.vendorProfileBefore !== null && cleanup.vendorId !== null) {
    const before = cleanup.vendorProfileBefore;
    const result = await call('PATCH', `/purchase/vendors/${cleanup.vendorId}/profile`, {
      paymentTerms: before.paymentTerms,
      creditDays: before.creditDays,
      bankName: before.bankName,
      bankAccount: before.bankAccount,
      bankIfsc: before.bankIfsc,
      openingBalance: before.openingBalance,
      isApproved: before.isApproved,
      defaultLocationId: before.defaultLocationId,
    });
    check('restores the vendor profile it edited', result.status === 200, result.body);
  }
}

try {
  await main();
} catch (error) {
  failed += 1;
  console.error('\n  FAIL  the run threw', error);
} finally {
  if (token !== null) {
    try {
      await teardown();
    } catch (error) {
      failed += 1;
      console.error('\n  FAIL  cleanup threw', error);
    }
  }
}

console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed === 0 ? 0 : 1);
