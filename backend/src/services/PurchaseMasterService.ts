import {
  BatchIssuePolicy,
  EntityType,
  LIMITS,
  MasterStatus,
  ProductKind,
  ValuationMethod,
  type CreateInventoryLocationRequest,
  type CreateProductRequest,
  type CreateUomRequest,
  type InventoryLocationDto,
  type InventoryLocationListQuery,
  type ProductDto,
  type ProductListQuery,
  type ProductLocationDto,
  type SupplierProductDto,
  type SupplierProductListQuery,
  type UomDto,
  type UomListQuery,
  type UpdateInventoryLocationRequest,
  type UpdateProductRequest,
  type UpdateUomRequest,
  type UpdateVendorProfileRequest,
  type UpsertProductLocationRequest,
  type UpsertSupplierProductRequest,
  type VendorSummaryDto,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { selectOne, type Db } from '../db/types';
import type { CountRow } from '../models/rows';
import {
  mapInventoryLocation,
  mapProduct,
  mapProductLocation,
  mapSupplierProduct,
  mapUom,
  mapVendorSummary,
} from '../models/mappers';
import {
  inventoryLocationRepository,
  type InventoryLocationListFilter,
} from '../repositories/InventoryLocationRepository';
import { productRepository, type ProductListFilter } from '../repositories/ProductRepository';
import {
  supplierProductRepository,
  type SupplierProductListFilter,
} from '../repositories/SupplierProductRepository';
import { uomRepository, type UomListFilter } from '../repositories/UomRepository';
import { vendorRepository, type VendorListFilter } from '../repositories/VendorRepository';
import { ConflictError, NotFoundError, StaleWriteError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { allocateProductCode } from '../utils/productCode';
import { toProperCase } from '../utils/textCase';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * Purchase master data: units, inventory locations, the product master with its per-location
 * stock policy, the supplier ↔ product mapping, and the purchase profile on a VENDOR entity.
 *
 * Five small services rather than one large one, because they are five masters that happen to
 * be introduced together; they share this file only so the rules that apply across all of them
 * — duplicate-key translation, "at most one default", optimistic concurrency — are stated once.
 */

/* ------------------------------------------------------------------ shared helpers --- */

interface DriverError {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

/**
 * The constraint a MySQL 1062 names, or null if the error was not a duplicate key.
 *
 * Returns the bare index name: the driver reports `'menuboard.products.uq_products_code'` on
 * MySQL 8 and `'uq_products_code'` on MariaDB, and the caller should not have to care.
 */
function duplicateKeyOf(error: unknown): string | null {
  const driverError = error as DriverError;
  if (driverError.errno !== 1062 && driverError.code !== 'ER_DUP_ENTRY') return null;
  const match = /for key '([^']+)'/.exec(driverError.sqlMessage ?? '');
  const raw = match?.[1] ?? '';
  const parts = raw.split('.');
  return parts[parts.length - 1] ?? '';
}

/** What each unique index means in words the operator can act on. */
const DUPLICATE_MESSAGES: Readonly<Record<string, string>> = {
  uq_uoms_code: 'A unit with this code already exists',
  uq_inventory_locations_code: 'An inventory location with this code already exists',
  uq_products_code: 'A product with this code already exists',
  uq_products_name: 'A product with this name already exists',
  uq_product_locations: 'This product already has stock policy at this location',
  uq_supplier_products: 'This supplier is already mapped to this product',
  uq_supplier_products_sku: 'This supplier already uses that SKU for another product',
};

/**
 * Runs `work`, turning a duplicate-key violation into a ConflictError that names the clash.
 *
 * Uniqueness is pre-checked before every write, but a pre-check is a race, not a guarantee —
 * this is what makes the guarantee, and it is what keeps a raw driver error from reaching the
 * client when two operators save the same code at the same moment.
 */
async function guardDuplicates<T>(fallback: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const key = duplicateKeyOf(error);
    if (key === null) throw error;
    throw new ConflictError(DUPLICATE_MESSAGES[key] ?? fallback);
  }
}

function assertConversionFactor(value: number | undefined, field: string): void {
  if (value === undefined) return;
  if (
    !Number.isFinite(value) ||
    value < LIMITS.CONVERSION_FACTOR_MIN ||
    value > LIMITS.CONVERSION_FACTOR_MAX
  ) {
    throw new ValidationError('The conversion factor is out of range', [
      {
        path: field,
        message: `Must be between ${LIMITS.CONVERSION_FACTOR_MIN} and ${LIMITS.CONVERSION_FACTOR_MAX}`,
      },
    ]);
  }
}

/** A max below a min is refused here rather than left to the table's CHECK constraint. */
function assertStockLevels(min: number | null, max: number | null): void {
  if (min === null || max === null) return;
  if (max < min) {
    throw new ValidationError('Stock levels are inconsistent', [
      { path: 'maxStock', message: 'The maximum stock cannot be below the minimum stock' },
    ]);
  }
}

function pagingFor(query: { page?: number; pageSize?: number }): {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
} {
  const { page, pageSize, offset } = resolvePaging(query);
  return { limit: pageSize, offset, page, pageSize };
}

/* ------------------------------------------------------------------ units of measure --- */

export class UomService {
  async list(query: UomListQuery) {
    const paging = pagingFor(query);
    const filter: UomListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.dimension !== undefined ? { dimension: query.dimension } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      limit: paging.limit,
      offset: paging.offset,
    };
    const { rows, total } = await uomRepository.list(getPool(), filter);
    return buildPage(rows.map(mapUom), total, paging.page, paging.pageSize);
  }

  async getById(id: string): Promise<UomDto> {
    const row = await uomRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Unit', id);
    return mapUom(row);
  }

  async create(input: CreateUomRequest, actor: AuditActor): Promise<UomDto> {
    assertConversionFactor(input.factorToBase, 'factorToBase');

    const row = await guardDuplicates('A unit with these values already exists', () =>
      withTransaction(async (connection) => {
        const code = input.code.trim().toUpperCase();
        const clash = await uomRepository.findByCode(connection, code);
        if (clash !== null) throw new ConflictError('A unit with this code already exists');

        const created = await uomRepository.insert(connection, {
          id: input.id ?? newId(),
          code,
          name: input.name.trim(),
          dimension: input.dimension,
          isBase: input.isBase ?? false,
          factorToBase: input.factorToBase ?? 1,
          decimalPlaces: input.decimalPlaces ?? 3,
          status: input.status ?? MasterStatus.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
          createdBy: actor.userId ?? null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.UOM_CREATED,
          entityType: 'uom',
          entityId: created.id,
          after: { code: created.code, name: created.name, dimension: created.dimension },
        });
        return created;
      }),
    );
    return mapUom(row);
  }

  async update(id: string, input: UpdateUomRequest, actor: AuditActor): Promise<UomDto> {
    assertConversionFactor(input.factorToBase, 'factorToBase');

    const row = await guardDuplicates('A unit with these values already exists', () =>
      withTransaction(async (connection) => {
        const before = await uomRepository.findById(connection, id);
        if (before === null) throw new NotFoundError('Unit', id);

        const code = input.code === undefined ? undefined : input.code.trim().toUpperCase();
        if (code !== undefined) {
          const clash = await uomRepository.findByCode(connection, code);
          if (clash !== null && clash.id !== id) {
            throw new ConflictError('A unit with this code already exists');
          }
        }

        const updated = await uomRepository.update(connection, id, {
          ...(code !== undefined ? { code } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.dimension !== undefined ? { dimension: input.dimension } : {}),
          ...(input.isBase !== undefined ? { isBase: input.isBase } : {}),
          ...(input.factorToBase !== undefined ? { factorToBase: input.factorToBase } : {}),
          ...(input.decimalPlaces !== undefined ? { decimalPlaces: input.decimalPlaces } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        });
        if (updated === null) throw new NotFoundError('Unit', id);

        await auditService.record(connection, actor, {
          action: AuditAction.UOM_UPDATED,
          entityType: 'uom',
          entityId: id,
          before: { code: before.code, name: before.name, status: before.status },
          after: { code: updated.code, name: updated.name, status: updated.status },
        });
        return updated;
      }),
    );
    return mapUom(row);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await uomRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Unit', id);

      const references = await uomRepository.countProductReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `"${before.code}" is used by ${references} product or supplier mapping(s) and cannot be deleted. Set it to INACTIVE instead.`,
        );
      }

      await uomRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.UOM_DELETED,
        entityType: 'uom',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }
}

/* --------------------------------------------------------------- inventory locations --- */

export class InventoryLocationService {
  async list(query: InventoryLocationListQuery) {
    const paging = pagingFor(query);
    const filter: InventoryLocationListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.parentId !== undefined ? { parentId: query.parentId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      limit: paging.limit,
      offset: paging.offset,
    };
    const { rows, total } = await inventoryLocationRepository.list(getPool(), filter);
    return buildPage(rows.map(mapInventoryLocation), total, paging.page, paging.pageSize);
  }

  async getById(id: string): Promise<InventoryLocationDto> {
    const row = await inventoryLocationRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Inventory location', id);
    return mapInventoryLocation(row);
  }

  async create(
    input: CreateInventoryLocationRequest,
    actor: AuditActor,
  ): Promise<InventoryLocationDto> {
    const row = await guardDuplicates('A location with these values already exists', () =>
      withTransaction(async (connection) => {
        const code = input.code.trim().toUpperCase();
        const clash = await inventoryLocationRepository.findByCode(connection, code);
        if (clash !== null) {
          throw new ConflictError('An inventory location with this code already exists');
        }

        const isDefaultReceiving = input.isDefaultReceiving ?? false;
        const id = input.id ?? newId();
        // At most one receiving default globally: stand the incumbent down first, in the same
        // transaction, so there is never a moment with two or none.
        if (isDefaultReceiving) {
          await inventoryLocationRepository.clearDefaultReceiving(connection, id);
        }

        const created = await inventoryLocationRepository.insert(connection, {
          id,
          code,
          name: input.name.trim(),
          nameHi: input.nameHi ?? null,
          kind: input.kind,
          parentId: input.parentId ?? null,
          counterId: input.counterId ?? null,
          stationId: input.stationId ?? null,
          department: input.department ?? null,
          isDefaultReceiving,
          allowsNegativeStock: input.allowsNegativeStock ?? false,
          status: input.status ?? MasterStatus.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
          notes: input.notes ?? null,
          createdBy: actor.userId ?? null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.INVENTORY_LOCATION_CREATED,
          entityType: 'inventory_location',
          entityId: created.id,
          after: { code: created.code, name: created.name, kind: created.kind },
        });
        return created;
      }),
    );
    return mapInventoryLocation(row);
  }

  async update(
    id: string,
    input: UpdateInventoryLocationRequest,
    actor: AuditActor,
  ): Promise<InventoryLocationDto> {
    const row = await guardDuplicates('A location with these values already exists', () =>
      withTransaction(async (connection) => {
        const before = await inventoryLocationRepository.findById(connection, id);
        if (before === null) throw new NotFoundError('Inventory location', id);

        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== Number(before.revision)
        ) {
          throw new StaleWriteError(Number(before.revision));
        }

        if (input.parentId !== undefined && input.parentId === id) {
          throw new ValidationError('A location cannot be its own parent', [
            { path: 'parentId', message: 'Choose a different parent location' },
          ]);
        }

        const code = input.code === undefined ? undefined : input.code.trim().toUpperCase();
        if (code !== undefined) {
          const clash = await inventoryLocationRepository.findByCode(connection, code);
          if (clash !== null && clash.id !== id) {
            throw new ConflictError('An inventory location with this code already exists');
          }
        }

        if (input.isDefaultReceiving === true) {
          await inventoryLocationRepository.clearDefaultReceiving(connection, id);
        }

        const updated = await inventoryLocationRepository.update(connection, id, {
          ...(code !== undefined ? { code } : {}),
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.counterId !== undefined ? { counterId: input.counterId } : {}),
          ...(input.stationId !== undefined ? { stationId: input.stationId } : {}),
          ...(input.department !== undefined ? { department: input.department } : {}),
          ...(input.isDefaultReceiving !== undefined
            ? { isDefaultReceiving: input.isDefaultReceiving }
            : {}),
          ...(input.allowsNegativeStock !== undefined
            ? { allowsNegativeStock: input.allowsNegativeStock }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        });
        if (updated === null) throw new NotFoundError('Inventory location', id);

        await auditService.record(connection, actor, {
          action: AuditAction.INVENTORY_LOCATION_UPDATED,
          entityType: 'inventory_location',
          entityId: id,
          before: {
            code: before.code,
            name: before.name,
            status: before.status,
            isDefaultReceiving: before.is_default_receiving === 1,
          },
          after: {
            code: updated.code,
            name: updated.name,
            status: updated.status,
            isDefaultReceiving: updated.is_default_receiving === 1,
          },
        });
        return updated;
      }),
    );
    return mapInventoryLocation(row);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await inventoryLocationRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Inventory location', id);

      const references = await inventoryLocationRepository.countReferences(connection, id);
      if (references > 0) {
        throw new ConflictError(
          `"${before.name}" is still referenced by ${references} product, stock policy or child location(s) and cannot be deleted. Set it to INACTIVE instead.`,
        );
      }

      await inventoryLocationRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.INVENTORY_LOCATION_DELETED,
        entityType: 'inventory_location',
        entityId: id,
        before: { code: before.code, name: before.name },
      });
    });
  }
}

/* -------------------------------------------------------------------- product master --- */

export class ProductService {
  async list(query: ProductListQuery) {
    const paging = pagingFor(query);
    const filter: ProductListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.purchasableOnly !== undefined ? { purchasableOnly: query.purchasableOnly } : {}),
      ...(query.stockedOnly !== undefined ? { stockedOnly: query.stockedOnly } : {}),
      ...(query.batchTrackedOnly !== undefined
        ? { batchTrackedOnly: query.batchTrackedOnly }
        : {}),
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.locationId !== undefined ? { locationId: query.locationId } : {}),
      ...(query.belowReorderLevel !== undefined
        ? { belowReorderLevel: query.belowReorderLevel }
        : {}),
      ...(query.includeStock !== undefined ? { includeStock: query.includeStock } : {}),
      limit: paging.limit,
      offset: paging.offset,
    };
    const { rows, total } = await productRepository.list(getPool(), filter);

    // `stockOnHand` is the summed `stock_balances` quantity, joined only when asked for; the
    // mapper carries it through when the column is present and omits it when it is not.
    return buildPage(rows.map(mapProduct), total, paging.page, paging.pageSize);
  }

  async getById(id: string): Promise<ProductDto> {
    const row = await productRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Product', id);
    return mapProduct(row);
  }

  /**
   * Resolves the human-readable stock unit recipes display.
   *
   * `products.unit` is the column the recipe master, the sync entity and the phone all read,
   * so it can never be left blank by a purchase-side write. An explicit unit wins; otherwise
   * the chosen stock UOM's code is used, which is what makes "set the stock unit to KG" also
   * make the recipe screens say KG.
   */
  private async resolveUnit(
    db: Db,
    explicit: string | undefined,
    stockUomId: string | null | undefined,
    fallback: string,
  ): Promise<string> {
    if (explicit !== undefined && explicit.trim() !== '') return explicit.trim();
    if (stockUomId !== undefined && stockUomId !== null) {
      const uom = await uomRepository.findById(db, stockUomId);
      if (uom === null) {
        throw new ValidationError('The stock unit does not exist', [
          { path: 'stockUomId', message: 'Choose a unit from the unit master' },
        ]);
      }
      return uom.code;
    }
    return fallback;
  }

  async create(input: CreateProductRequest, actor: AuditActor): Promise<ProductDto> {
    assertConversionFactor(input.purchaseConversionFactor, 'purchaseConversionFactor');
    assertStockLevels(input.minStock ?? null, input.maxStock ?? null);

    const row = await guardDuplicates('A product with these values already exists', () =>
      withTransaction(async (connection) => {
        const name = toProperCase(input.name.trim());
        const nameClash = await productRepository.findByName(connection, name);
        if (nameClash !== null) {
          throw new ConflictError('A product with this name already exists');
        }

        // Every product carries a code. Leaving the field blank does not mean "no code" — it
        // means "the server should draw one from this product's own category and name" — so an
        // empty request never reaches the insert as a null.
        const requestedCode = input.code === undefined || input.code === null ? '' : input.code.trim();
        const code =
          requestedCode === ''
            ? await allocateProductCode(connection, input.categoryId ?? null, name)
            : requestedCode;
        if (requestedCode !== '') {
          const codeClash = await productRepository.findByCode(connection, code);
          if (codeClash !== null) {
            throw new ConflictError('A product with this code already exists');
          }
        }

        const unit = await this.resolveUnit(connection, input.unit, input.stockUomId, 'GM');

        const created = await productRepository.insert(connection, {
          id: input.id ?? newId(),
          categoryId: input.categoryId ?? null,
          name,
          nameHi: input.nameHi ?? null,
          unit,
          status: input.status ?? MasterStatus.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
          code,
          barcode: input.barcode ?? null,
          brand: input.brand ?? null,
          description: input.description ?? null,
          kind: input.kind ?? ProductKind.STOCK,
          hsnSacId: input.hsnSacId ?? null,
          taxProfileId: input.taxProfileId ?? null,
          stockUomId: input.stockUomId ?? null,
          purchaseUomId: input.purchaseUomId ?? null,
          purchaseConversionFactor: input.purchaseConversionFactor ?? 1,
          packSize: input.packSize ?? null,
          isBatchTracked: input.isBatchTracked ?? false,
          isExpiryTracked: input.isExpiryTracked ?? false,
          shelfLifeDays: input.shelfLifeDays ?? null,
          batchIssuePolicy: input.batchIssuePolicy ?? BatchIssuePolicy.FEFO,
          valuationMethod: input.valuationMethod ?? ValuationMethod.MOVING_AVERAGE,
          standardCost: input.standardCost ?? null,
          defaultLocationId: input.defaultLocationId ?? null,
          preferredSupplierId: input.preferredSupplierId ?? null,
          minStock: input.minStock ?? null,
          reorderLevel: input.reorderLevel ?? null,
          maxStock: input.maxStock ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          isPurchasable: input.isPurchasable ?? true,
          isStocked: input.isStocked ?? true,
          createdBy: actor.userId ?? null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.PRODUCT_CREATED,
          entityType: 'product',
          entityId: created.id,
          after: { name: created.name, code: created.code, unit: created.unit },
        });
        return created;
      }),
    );
    return mapProduct(row);
  }

  async update(id: string, input: UpdateProductRequest, actor: AuditActor): Promise<ProductDto> {
    assertConversionFactor(input.purchaseConversionFactor, 'purchaseConversionFactor');

    const row = await guardDuplicates('A product with these values already exists', () =>
      withTransaction(async (connection) => {
        const before = await productRepository.findById(connection, id);
        if (before === null) throw new NotFoundError('Product', id);

        if (
          input.expectedRevision !== undefined &&
          input.expectedRevision !== Number(before.revision)
        ) {
          throw new StaleWriteError(Number(before.revision));
        }

        const name = input.name === undefined ? undefined : toProperCase(input.name.trim());
        if (name !== undefined) {
          const clash = await productRepository.findByName(connection, name);
          if (clash !== null && clash.id !== id) {
            throw new ConflictError('A product with this name already exists');
          }
        }

        // As on create: a field explicitly cleared to blank means "give this one a fresh
        // server-drawn code", not "leave it with no code" — a product is never left without
        // one. Leaving the field out of the request entirely (`undefined`) still leaves the
        // stored code untouched.
        let code: string | undefined;
        if (input.code !== undefined) {
          const requested = input.code === null ? '' : input.code.trim();
          if (requested === '') {
            code = await allocateProductCode(
              connection,
              input.categoryId !== undefined ? input.categoryId : before.category_id,
              name ?? before.name,
              id,
            );
          } else {
            const clash = await productRepository.findByCode(connection, requested);
            if (clash !== null && clash.id !== id) {
              throw new ConflictError('A product with this code already exists');
            }
            code = requested;
          }
        }

        // Levels are checked against the row as it will be, not as it was: patching only the
        // maximum must still be refused if it lands below the stored minimum.
        assertStockLevels(
          input.minStock !== undefined
            ? input.minStock
            : before.min_stock === null
              ? null
              : Number(before.min_stock),
          input.maxStock !== undefined
            ? input.maxStock
            : before.max_stock === null
              ? null
              : Number(before.max_stock),
        );

        // Only re-derive the display unit when the stock unit actually moved; a patch that
        // does not mention either must leave what the recipes show alone.
        const unit =
          input.unit !== undefined || input.stockUomId !== undefined
            ? await this.resolveUnit(connection, input.unit, input.stockUomId, before.unit)
            : undefined;

        const updated = await productRepository.update(connection, id, {
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
          ...(unit !== undefined ? { unit } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(code !== undefined ? { code } : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.brand !== undefined ? { brand: input.brand } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.hsnSacId !== undefined ? { hsnSacId: input.hsnSacId } : {}),
          ...(input.taxProfileId !== undefined ? { taxProfileId: input.taxProfileId } : {}),
          ...(input.stockUomId !== undefined ? { stockUomId: input.stockUomId } : {}),
          ...(input.purchaseUomId !== undefined ? { purchaseUomId: input.purchaseUomId } : {}),
          ...(input.purchaseConversionFactor !== undefined
            ? { purchaseConversionFactor: input.purchaseConversionFactor }
            : {}),
          ...(input.packSize !== undefined ? { packSize: input.packSize } : {}),
          ...(input.isBatchTracked !== undefined ? { isBatchTracked: input.isBatchTracked } : {}),
          ...(input.isExpiryTracked !== undefined
            ? { isExpiryTracked: input.isExpiryTracked }
            : {}),
          ...(input.shelfLifeDays !== undefined ? { shelfLifeDays: input.shelfLifeDays } : {}),
          ...(input.batchIssuePolicy !== undefined
            ? { batchIssuePolicy: input.batchIssuePolicy }
            : {}),
          ...(input.valuationMethod !== undefined
            ? { valuationMethod: input.valuationMethod }
            : {}),
          ...(input.standardCost !== undefined ? { standardCost: input.standardCost } : {}),
          ...(input.defaultLocationId !== undefined
            ? { defaultLocationId: input.defaultLocationId }
            : {}),
          ...(input.preferredSupplierId !== undefined
            ? { preferredSupplierId: input.preferredSupplierId }
            : {}),
          ...(input.minStock !== undefined ? { minStock: input.minStock } : {}),
          ...(input.reorderLevel !== undefined ? { reorderLevel: input.reorderLevel } : {}),
          ...(input.maxStock !== undefined ? { maxStock: input.maxStock } : {}),
          ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
          ...(input.isPurchasable !== undefined ? { isPurchasable: input.isPurchasable } : {}),
          ...(input.isStocked !== undefined ? { isStocked: input.isStocked } : {}),
        });
        if (updated === null) throw new NotFoundError('Product', id);

        await auditService.record(connection, actor, {
          action: AuditAction.PRODUCT_UPDATED,
          entityType: 'product',
          entityId: id,
          before: { name: before.name, code: before.code, status: before.status },
          after: { name: updated.name, code: updated.code, status: updated.status },
        });
        return updated;
      }),
    );
    return mapProduct(row);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await productRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Product', id);

      // The same guard the ingredient master has always had, and for the same reason: a
      // recipe line that stops resolving is a recipe nobody can cook.
      const referenced = await productRepository.isReferencedByRecipes(connection, id);
      if (referenced) {
        throw new ConflictError(
          `"${before.name}" is used by one or more recipes and cannot be deleted. Set it to INACTIVE instead.`,
        );
      }

      await productRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.PRODUCT_DELETED,
        entityType: 'product',
        entityId: id,
        before: { name: before.name, code: before.code },
      });
    });
  }

  /* ------------------------------------------- per-location stock policy */

  async listLocations(productId: string): Promise<ProductLocationDto[]> {
    const pool = getPool();
    const product = await productRepository.findById(pool, productId);
    if (product === null) throw new NotFoundError('Product', productId);
    const rows = await productRepository.listLocations(pool, productId);
    return rows.map(mapProductLocation);
  }

  async upsertLocation(
    productId: string,
    input: UpsertProductLocationRequest,
    actor: AuditActor,
  ): Promise<ProductLocationDto> {
    if (input.productId !== undefined && input.productId !== productId) {
      throw new ValidationError('The product in the body does not match the one in the path', [
        { path: 'productId', message: 'Remove it or make it match the path' },
      ]);
    }
    assertStockLevels(input.minStock ?? null, input.maxStock ?? null);

    const row = await guardDuplicates('This stock policy already exists', () =>
      withTransaction(async (connection) => {
        const product = await productRepository.findById(connection, productId);
        if (product === null) throw new NotFoundError('Product', productId);

        const location = await inventoryLocationRepository.findById(connection, input.locationId);
        if (location === null) throw new NotFoundError('Inventory location', input.locationId);

        const existing = await productRepository.findLocation(
          connection,
          productId,
          input.locationId,
        );
        const isDefaultDestination = input.isDefaultDestination ?? false;
        // At most one default destination per product, scoped to this product only.
        if (isDefaultDestination) {
          await productRepository.clearDefaultDestination(
            connection,
            productId,
            input.locationId,
          );
        }

        const saved = await productRepository.upsertLocation(connection, {
          id: existing?.id ?? input.id ?? newId(),
          productId,
          locationId: input.locationId,
          minStock: input.minStock ?? null,
          reorderLevel: input.reorderLevel ?? null,
          maxStock: input.maxStock ?? null,
          isDefaultDestination,
          bin: input.bin ?? null,
          status: input.status ?? MasterStatus.ACTIVE,
          createdBy: actor.userId ?? null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.PRODUCT_LOCATION_UPSERTED,
          entityType: 'product_location',
          entityId: saved.id,
          ...(existing === null
            ? {}
            : {
              before: {
                reorderLevel: existing.reorder_level,
                isDefaultDestination: existing.is_default_destination === 1,
              },
            }),
          after: {
            productId,
            locationId: saved.location_id,
            reorderLevel: saved.reorder_level,
            isDefaultDestination: saved.is_default_destination === 1,
          },
        });
        return saved;
      }),
    );
    return mapProductLocation(row);
  }

  async removeLocation(productId: string, locationId: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const existing = await productRepository.findLocation(connection, productId, locationId);
      if (existing === null || existing.deleted_at !== null) {
        throw new NotFoundError('Product stock policy', locationId);
      }

      await productRepository.softDeleteLocation(connection, productId, locationId);
      await auditService.record(connection, actor, {
        action: AuditAction.PRODUCT_LOCATION_DELETED,
        entityType: 'product_location',
        entityId: existing.id,
        before: { productId, locationId },
      });
    });
  }
}

/* ------------------------------------------------------------ supplier ↔ product map --- */

export class SupplierProductService {
  async list(query: SupplierProductListQuery) {
    const paging = pagingFor(query);
    const filter: SupplierProductListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.preferredOnly !== undefined ? { preferredOnly: query.preferredOnly } : {}),
      limit: paging.limit,
      offset: paging.offset,
    };
    const { rows, total } = await supplierProductRepository.list(getPool(), filter);
    return buildPage(rows.map(mapSupplierProduct), total, paging.page, paging.pageSize);
  }

  async getById(id: string): Promise<SupplierProductDto> {
    const row = await supplierProductRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Supplier product', id);
    return mapSupplierProduct(row);
  }

  /** The supplier half of the mapping is an entity of type VENDOR, and only that. */
  private async assertVendor(db: Db, supplierId: string): Promise<void> {
    const row = await selectOne<CountRow>(
      db,
      `SELECT COUNT(*) AS total FROM entities
        WHERE id = ? AND type = ? AND deleted_at IS NULL`,
      [supplierId, EntityType.VENDOR],
    );
    if (row === null || Number(row.total) === 0) {
      throw new ValidationError('The supplier must be an active VENDOR entity', [
        { path: 'supplierId', message: 'No VENDOR entity with this id' },
      ]);
    }
  }

  /**
   * Creates the mapping, or updates the one that already exists for this supplier and product.
   *
   * Upsert rather than plain insert because `uq_supplier_products` makes a second row
   * impossible anyway, and because the caller — frequently bill-scanning — legitimately does
   * not know whether it has seen this pairing before.
   */
  async upsert(
    input: UpsertSupplierProductRequest,
    actor: AuditActor,
  ): Promise<{ dto: SupplierProductDto; created: boolean }> {
    assertConversionFactor(input.conversionFactor, 'conversionFactor');

    const result = await guardDuplicates('This supplier mapping already exists', () =>
      withTransaction(async (connection) => {
        await this.assertVendor(connection, input.supplierId);

        const product = await productRepository.findById(connection, input.productId);
        if (product === null) throw new NotFoundError('Product', input.productId);

        const sku =
          input.supplierSku === undefined || input.supplierSku === null
            ? null
            : input.supplierSku.trim();
        if (sku !== null && sku !== '') {
          const skuClash = await supplierProductRepository.findBySupplierAndSku(
            connection,
            input.supplierId,
            sku,
          );
          if (skuClash !== null && skuClash.product_id !== input.productId) {
            throw new ConflictError('This supplier already uses that SKU for another product');
          }
        }

        const existing = await supplierProductRepository.findBySupplierAndProduct(
          connection,
          input.supplierId,
          input.productId,
        );
        const isPreferred = input.isPreferred ?? false;
        // At most one preferred supplier per product.
        if (isPreferred) {
          await supplierProductRepository.clearPreferred(
            connection,
            input.productId,
            existing?.id ?? null,
          );
        }

        if (existing !== null) {
          const updated = await supplierProductRepository.update(
            connection,
            existing.id,
            {
              supplierSku: sku === '' ? null : sku,
              supplierProductName: input.supplierProductName ?? null,
              barcode: input.barcode ?? null,
              purchaseUomId: input.purchaseUomId ?? null,
              conversionFactor: input.conversionFactor ?? 1,
              packSize: input.packSize ?? null,
              leadTimeDays: input.leadTimeDays ?? null,
              isPreferred,
              status: input.status ?? MasterStatus.ACTIVE,
              notes: input.notes ?? null,
            },
            { revive: true },
          );
          if (updated === null) throw new NotFoundError('Supplier product', existing.id);

          await auditService.record(connection, actor, {
            action: AuditAction.SUPPLIER_PRODUCT_UPSERTED,
            entityType: 'supplier_product',
            entityId: updated.id,
            before: { supplierSku: existing.supplier_sku, isPreferred: existing.is_preferred === 1 },
            after: { supplierSku: updated.supplier_sku, isPreferred: updated.is_preferred === 1 },
          });
          return { row: updated, created: false };
        }

        const created = await supplierProductRepository.insert(connection, {
          id: input.id ?? newId(),
          supplierId: input.supplierId,
          productId: input.productId,
          supplierSku: sku === '' ? null : sku,
          supplierProductName: input.supplierProductName ?? null,
          barcode: input.barcode ?? null,
          purchaseUomId: input.purchaseUomId ?? null,
          conversionFactor: input.conversionFactor ?? 1,
          packSize: input.packSize ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          isPreferred,
          status: input.status ?? MasterStatus.ACTIVE,
          notes: input.notes ?? null,
          createdBy: actor.userId ?? null,
        });

        await auditService.record(connection, actor, {
          action: AuditAction.SUPPLIER_PRODUCT_UPSERTED,
          entityType: 'supplier_product',
          entityId: created.id,
          after: {
            supplierId: created.supplier_id,
            productId: created.product_id,
            supplierSku: created.supplier_sku,
          },
        });
        return { row: created, created: true };
      }),
    );
    return { dto: mapSupplierProduct(result.row), created: result.created };
  }

  async update(
    id: string,
    input: Partial<UpsertSupplierProductRequest>,
    actor: AuditActor,
  ): Promise<SupplierProductDto> {
    assertConversionFactor(input.conversionFactor, 'conversionFactor');

    const row = await guardDuplicates('This supplier mapping already exists', () =>
      withTransaction(async (connection) => {
        const before = await supplierProductRepository.findById(connection, id);
        if (before === null) throw new NotFoundError('Supplier product', id);

        // An edit form may restate which supplier and product the row is for; it may not
        // change them. Re-pointing a mapping would silently rewrite what a scanned SKU
        // resolves to, and the correct move is to delete this row and map the other pairing.
        if (input.supplierId !== undefined && input.supplierId !== before.supplier_id) {
          throw new ValidationError('A mapping cannot be moved to a different supplier', [
            { path: 'supplierId', message: 'Delete this mapping and create the new one instead' },
          ]);
        }
        if (input.productId !== undefined && input.productId !== before.product_id) {
          throw new ValidationError('A mapping cannot be moved to a different product', [
            { path: 'productId', message: 'Delete this mapping and create the new one instead' },
          ]);
        }

        const sku =
          input.supplierSku === undefined || input.supplierSku === null
            ? undefined
            : input.supplierSku.trim();
        if (sku !== undefined && sku !== '') {
          const clash = await supplierProductRepository.findBySupplierAndSku(
            connection,
            before.supplier_id,
            sku,
          );
          if (clash !== null && clash.id !== id) {
            throw new ConflictError('This supplier already uses that SKU for another product');
          }
        }

        if (input.isPreferred === true) {
          await supplierProductRepository.clearPreferred(connection, before.product_id, id);
        }

        const updated = await supplierProductRepository.update(connection, id, {
          ...(input.supplierSku !== undefined
            ? { supplierSku: sku === undefined || sku === '' ? null : sku }
            : {}),
          ...(input.supplierProductName !== undefined
            ? { supplierProductName: input.supplierProductName }
            : {}),
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.purchaseUomId !== undefined ? { purchaseUomId: input.purchaseUomId } : {}),
          ...(input.conversionFactor !== undefined
            ? { conversionFactor: input.conversionFactor }
            : {}),
          ...(input.packSize !== undefined ? { packSize: input.packSize } : {}),
          ...(input.leadTimeDays !== undefined ? { leadTimeDays: input.leadTimeDays } : {}),
          ...(input.isPreferred !== undefined ? { isPreferred: input.isPreferred } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        });
        if (updated === null) throw new NotFoundError('Supplier product', id);

        await auditService.record(connection, actor, {
          action: AuditAction.SUPPLIER_PRODUCT_UPSERTED,
          entityType: 'supplier_product',
          entityId: id,
          before: { supplierSku: before.supplier_sku, status: before.status },
          after: { supplierSku: updated.supplier_sku, status: updated.status },
        });
        return updated;
      }),
    );
    return mapSupplierProduct(row);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await supplierProductRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Supplier product', id);

      await supplierProductRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.SUPPLIER_PRODUCT_DELETED,
        entityType: 'supplier_product',
        entityId: id,
        before: { supplierId: before.supplier_id, productId: before.product_id },
      });
    });
  }
}

/* ------------------------------------------------------------ vendor purchase profile --- */

export class VendorProfileService {
  async list(query: { page?: number; pageSize?: number; search?: string; status?: MasterStatus }) {
    const paging = pagingFor(query);
    const filter: VendorListFilter = {
      ...(query.search !== undefined ? { search: query.search } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      limit: paging.limit,
      offset: paging.offset,
    };
    const { rows, total } = await vendorRepository.list(getPool(), filter);
    return buildPage(rows.map(mapVendorSummary), total, paging.page, paging.pageSize);
  }

  async getById(entityId: string): Promise<VendorSummaryDto> {
    const row = await vendorRepository.findById(getPool(), entityId);
    if (row === null) throw new NotFoundError('Vendor', entityId);
    return mapVendorSummary(row);
  }

  async updateProfile(
    entityId: string,
    input: UpdateVendorProfileRequest,
    actor: AuditActor,
  ): Promise<VendorSummaryDto> {
    const row = await withTransaction(async (connection) => {
      const before = await vendorRepository.findById(connection, entityId);
      if (before === null) throw new NotFoundError('Vendor', entityId);

      if (input.defaultLocationId !== undefined && input.defaultLocationId !== null) {
        const location = await inventoryLocationRepository.findById(
          connection,
          input.defaultLocationId,
        );
        if (location === null) {
          throw new NotFoundError('Inventory location', input.defaultLocationId);
        }
      }

      const updated = await vendorRepository.updateProfile(connection, entityId, {
        ...(input.paymentTerms !== undefined ? { paymentTerms: input.paymentTerms } : {}),
        ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
        ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
        ...(input.bankAccount !== undefined ? { bankAccount: input.bankAccount } : {}),
        ...(input.bankIfsc !== undefined ? { bankIfsc: input.bankIfsc } : {}),
        ...(input.openingBalance !== undefined ? { openingBalance: input.openingBalance } : {}),
        ...(input.isApproved !== undefined ? { isApproved: input.isApproved } : {}),
        ...(input.defaultLocationId !== undefined
          ? { defaultLocationId: input.defaultLocationId }
          : {}),
      });
      if (updated === null) throw new NotFoundError('Vendor', entityId);

      await auditService.record(connection, actor, {
        action: AuditAction.VENDOR_PROFILE_UPDATED,
        entityType: 'vendor_profile',
        entityId,
        before: {
          creditDays: Number(before.vendor_credit_days),
          isApproved: before.vendor_is_approved === 1,
          paymentTerms: before.vendor_payment_terms,
        },
        after: {
          creditDays: Number(updated.vendor_credit_days),
          isApproved: updated.vendor_is_approved === 1,
          paymentTerms: updated.vendor_payment_terms,
        },
      });
      return updated;
    });
    return mapVendorSummary(row);
  }
}

export const uomService = new UomService();
export const inventoryLocationService = new InventoryLocationService();
export const productService = new ProductService();
export const supplierProductService = new SupplierProductService();
export const vendorProfileService = new VendorProfileService();
