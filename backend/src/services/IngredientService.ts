import {
  MasterStatus,
  type IngredientCategoryDto,
  type IngredientCategoryWriteRequest,
  type IngredientDto,
  type IngredientWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { mapIngredient, mapIngredientCategory } from '../models/mappers';
import {
  ingredientCategoryRepository,
  ingredientRepository,
  type MasterListFilter,
} from '../repositories/IngredientRepository';
import { ConflictError, NotFoundError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

export interface MasterQuery {
  search?: string;
  status?: MasterStatus;
  page?: number;
  pageSize?: number;
}

function pagingFor(query: MasterQuery): MasterListFilter & { page: number; pageSize: number } {
  const { page, pageSize, offset } = resolvePaging(query);
  return {
    ...(query.search !== undefined ? { search: query.search } : {}),
    ...(query.status !== undefined ? { status: query.status } : {}),
    limit: pageSize,
    offset,
    page,
    pageSize,
  };
}

/**
 * The recipe-only ingredient master: `ingredient_categories` and `ingredients`.
 *
 * Writes are Admin Portal only, same as the other master data — ingredients are read by
 * recipes and, through them, by Android's offline recipe view, but never written there.
 */
export class IngredientService {
  /* ------------------------------------------------------------- categories */

  async listCategories(query: MasterQuery) {
    const filter = pagingFor(query);
    const { rows, total } = await ingredientCategoryRepository.list(getPool(), filter);
    return buildPage(rows.map(mapIngredientCategory), total, filter.page, filter.pageSize);
  }

  async createCategory(
    input: IngredientCategoryWriteRequest,
    actor: AuditActor,
  ): Promise<IngredientCategoryDto> {
    const row = await withTransaction(async (connection) => {
      const created = await ingredientCategoryRepository.insert(connection, {
        id: input.id ?? newId(),
        name: input.name.trim(),
        nameHi: input.nameHi ?? null,
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId ?? null,
      });
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'ingredient_category',
        entityId: created.id,
        after: { name: created.name },
      });
      return created;
    });
    return mapIngredientCategory(row);
  }

  async updateCategory(
    id: string,
    input: Partial<IngredientCategoryWriteRequest>,
    actor: AuditActor,
  ): Promise<IngredientCategoryDto> {
    const row = await withTransaction(async (connection) => {
      const before = await ingredientCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Ingredient category', id);

      const updated = await ingredientCategoryRepository.update(connection, id, {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (updated === null) throw new NotFoundError('Ingredient category', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'ingredient_category',
        entityId: id,
        before: { name: before.name },
        after: { name: updated.name },
      });
      return updated;
    });
    return mapIngredientCategory(row);
  }

  async deleteCategory(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await ingredientCategoryRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Ingredient category', id);
      await ingredientCategoryRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'ingredient_category',
        entityId: id,
        before: { name: before.name },
      });
    });
  }

  /* ------------------------------------------------------------- ingredients */

  async list(query: MasterQuery & { categoryId?: string }) {
    const filter = pagingFor(query);
    const { rows, total } = await ingredientRepository.list(getPool(), {
      ...filter,
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
    });
    return buildPage(rows.map(mapIngredient), total, filter.page, filter.pageSize);
  }

  async getById(id: string): Promise<IngredientDto> {
    const row = await ingredientRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Ingredient', id);
    return mapIngredient(row);
  }

  async distinctUnits(): Promise<string[]> {
    return ingredientRepository.distinctUnits(getPool());
  }

  async create(input: IngredientWriteRequest, actor: AuditActor): Promise<IngredientDto> {
    const row = await withTransaction(async (connection) => {
      const name = input.name.trim();
      const clash = await ingredientRepository.findByName(connection, name);
      if (clash !== null) {
        throw new ConflictError('An ingredient with this name already exists');
      }

      const created = await ingredientRepository.insert(connection, {
        id: input.id ?? newId(),
        categoryId: input.categoryId ?? null,
        name,
        nameHi: input.nameHi ?? null,
        unit: input.unit.trim(),
        status: input.status ?? MasterStatus.ACTIVE,
        sortOrder: input.sortOrder ?? 0,
        createdBy: actor.userId ?? null,
      });

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_CREATED,
        entityType: 'ingredient',
        entityId: created.id,
        after: { name: created.name, unit: created.unit },
      });
      return created;
    });
    return mapIngredient(row);
  }

  async update(
    id: string,
    input: Partial<IngredientWriteRequest>,
    actor: AuditActor,
  ): Promise<IngredientDto> {
    const row = await withTransaction(async (connection) => {
      const before = await ingredientRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Ingredient', id);

      if (input.name !== undefined) {
        const name = input.name.trim();
        const clash = await ingredientRepository.findByName(connection, name);
        if (clash !== null && clash.id !== id) {
          throw new ConflictError('An ingredient with this name already exists');
        }
      }

      const updated = await ingredientRepository.update(connection, id, {
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.nameHi !== undefined ? { nameHi: input.nameHi } : {}),
        ...(input.unit !== undefined ? { unit: input.unit.trim() } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      });
      if (updated === null) throw new NotFoundError('Ingredient', id);

      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_UPDATED,
        entityType: 'ingredient',
        entityId: id,
        before: { name: before.name, status: before.status },
        after: { name: updated.name, status: updated.status },
      });
      return updated;
    });
    return mapIngredient(row);
  }

  async remove(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const before = await ingredientRepository.findById(connection, id);
      if (before === null) throw new NotFoundError('Ingredient', id);

      const referenced = await ingredientRepository.isReferencedByRecipes(connection, id);
      if (referenced) {
        throw new ConflictError(
          `"${before.name}" is used by one or more recipes and cannot be deleted. Set it to INACTIVE instead.`,
        );
      }

      await ingredientRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.MASTER_DELETED,
        entityType: 'ingredient',
        entityId: id,
        before: { name: before.name },
      });
    });
  }
}

export const ingredientService = new IngredientService();
