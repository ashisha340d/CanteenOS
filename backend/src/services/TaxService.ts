import {
  GstTaxability,
  HsnSacCodeType,
  MasterStatus,
  SupplyType,
  ZERO_TAX_TAXABILITIES,
  type HsnSacCodeDto,
  type HsnSacSearchQuery,
  type TaxProfileDto,
  type TaxProfileWriteRequest,
} from '@menuboard/shared';
import { getPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db/types';
import { mapHsnSacCode, mapTaxProfile } from '../models/mappers';
import {
  HsnSacRepository,
  TaxProfileRepository,
  type TaxProfileListFilter,
} from '../repositories/TaxRepository';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { buildPage, resolvePaging } from '../utils/http';
import { newId } from '../utils/ids';
import { AuditAction, auditService, type AuditActor } from './AuditService';

/**
 * The Tax Profile master, and read access to the synchronized HSN/SAC classification master.
 *
 * Tax Profiles are the only place a GST rate is authored. Synchronizing the classification
 * master (GstSyncService) never touches them, so a food item's tax treatment stays exactly as
 * an administrator left it until an administrator changes it.
 */

export interface TaxProfileQuery {
  search?: string;
  status?: MasterStatus;
  page?: number;
  pageSize?: number;
}

function pagingFor(query: TaxProfileQuery): TaxProfileListFilter & { page: number; pageSize: number } {
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
 * CGST + SGST must equal IGST must equal the headline GST rate. Rejecting an inconsistent
 * split here keeps every downstream consumer from having to decide which number to believe.
 */
function assertRatesCoherent(input: {
  gstTaxability: GstTaxability;
  gstRate: number;
  cgstRate: number;
  sgstRate: number;
  igstRate: number;
}): void {
  const { gstTaxability, gstRate, cgstRate, sgstRate, igstRate } = input;

  if (ZERO_TAX_TAXABILITIES.includes(gstTaxability)) {
    if (gstRate !== 0 || cgstRate !== 0 || sgstRate !== 0 || igstRate !== 0) {
      throw new ValidationError(
        `A ${gstTaxability} profile cannot carry a non-zero GST rate`,
      );
    }
    return;
  }

  // Rates are DECIMAL(6,3); compare on the same scale rather than trusting float equality.
  const round = (value: number): number => Math.round(value * 1000);
  if (round(cgstRate) + round(sgstRate) !== round(gstRate)) {
    throw new ValidationError('CGST + SGST must equal the GST rate');
  }
  if (round(igstRate) !== round(gstRate)) {
    throw new ValidationError('IGST must equal the GST rate');
  }
}

/** A SERVICE profile classifies against a SAC code, a GOODS profile against an HSN code. */
function assertClassificationMatches(supplyType: SupplyType, codeType: HsnSacCodeType): void {
  const expected = supplyType === SupplyType.SERVICE ? HsnSacCodeType.SAC : HsnSacCodeType.HSN;
  if (codeType !== expected) {
    throw new ValidationError(
      `A ${supplyType} tax profile must reference ${expected} classification, not ${codeType}`,
    );
  }
}

export class TaxService {
  /* ------------------------------------------------- classification master (read-only) */

  async searchHsnSac(query: HsnSacSearchQuery) {
    const pool = getPool();
    const { page, pageSize, offset } = resolvePaging(query);
    const trimmed = query.q?.trim();
    const filter = {
      ...(trimmed !== undefined && trimmed !== '' ? { query: trimmed } : {}),
      ...(query.codeType !== undefined ? { codeType: query.codeType } : {}),
      activeOnly: query.activeOnly !== false,
      limit: pageSize,
      offset,
    };

    const [rows, total] = await Promise.all([
      HsnSacRepository.search(pool, filter),
      HsnSacRepository.countSearch(pool, filter),
    ]);
    return buildPage(rows.map(mapHsnSacCode), total, page, pageSize);
  }

  async getHsnSacById(id: string): Promise<HsnSacCodeDto> {
    const row = await HsnSacRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('HSN/SAC code', id);
    return mapHsnSacCode(row);
  }

  /* ------------------------------------------------------------- tax profiles */

  async listProfiles(query: TaxProfileQuery) {
    const pool = getPool();
    const filter = pagingFor(query);
    const [rows, total] = await Promise.all([
      TaxProfileRepository.list(pool, filter),
      TaxProfileRepository.count(pool, filter),
    ]);
    return buildPage(rows.map(mapTaxProfile), total, filter.page, filter.pageSize);
  }

  async getProfile(id: string): Promise<TaxProfileDto> {
    const row = await TaxProfileRepository.findById(getPool(), id);
    if (row === null) throw new NotFoundError('Tax profile', id);
    return mapTaxProfile(row);
  }

  /**
   * Validates the referenced classification code exists and matches the supply type. A code
   * that has been deactivated by a later sync may only be assigned by a caller holding
   * TAX_OVERRIDE — enforced at the route — and is recorded in the audit trail when it happens.
   */
  private async resolveClassification(
    db: Db,
    hsnSacId: string | null,
    supplyType: SupplyType,
  ): Promise<{ isInactive: boolean; code: string } | null> {
    if (hsnSacId === null) return null;
    const row = await HsnSacRepository.findById(db, hsnSacId);
    if (row === null) throw new NotFoundError('HSN/SAC code', hsnSacId);
    assertClassificationMatches(supplyType, row.code_type);
    return { isInactive: row.is_active !== 1, code: row.code };
  }

  async createProfile(input: TaxProfileWriteRequest, actor: AuditActor): Promise<TaxProfileDto> {
    const supplyType = input.supplyType;
    const gstTaxability = input.gstTaxability ?? GstTaxability.TAXABLE;
    const rates = {
      gstRate: input.gstRate ?? 0,
      cgstRate: input.cgstRate ?? 0,
      sgstRate: input.sgstRate ?? 0,
      igstRate: input.igstRate ?? 0,
      cessRate: input.cessRate ?? 0,
    };
    assertRatesCoherent({ gstTaxability, ...rates });

    const id = input.id ?? newId();

    return withTransaction(async (connection) => {
      const classification = await this.resolveClassification(
        connection,
        input.hsnSacId ?? null,
        supplyType,
      );

      try {
        await TaxProfileRepository.insert(connection, {
          id,
          code: input.code,
          name: input.name,
          description: input.description ?? null,
          hsnSacId: input.hsnSacId ?? null,
          supplyType,
          gstTaxability,
          ...rates,
          priceIsInclusive: input.priceIsInclusive ?? true,
          itcEligibility: input.itcEligibility ?? 'NOT_AVAILABLE',
          effectiveFrom: input.effectiveFrom ?? null,
          effectiveTo: input.effectiveTo ?? null,
          exemptionReason: input.exemptionReason ?? null,
          regulatoryNotes: input.regulatoryNotes ?? null,
          status: input.status ?? MasterStatus.ACTIVE,
          sortOrder: input.sortOrder ?? 0,
          createdBy: actor.userId,
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
          throw new ConflictError(`A tax profile with code "${input.code}" already exists`);
        }
        throw error;
      }

      const created = await TaxProfileRepository.findById(connection, id);
      if (created === null) throw new NotFoundError('Tax profile', id);

      await auditService.record(connection, actor, {
        action: AuditAction.TAX_PROFILE_CREATED,
        entityType: 'tax_profiles',
        entityId: id,
        after: { ...mapTaxProfile(created) },
      });
      if (classification?.isInactive === true) {
        await auditService.record(connection, actor, {
          action: AuditAction.TAX_HSN_OVERRIDDEN,
          entityType: 'tax_profiles',
          entityId: id,
          after: { hsnSacId: input.hsnSacId, code: classification.code, reason: 'inactive code' },
        });
      }

      return mapTaxProfile(created);
    });
  }

  async updateProfile(
    id: string,
    input: Partial<TaxProfileWriteRequest>,
    actor: AuditActor,
  ): Promise<TaxProfileDto> {
    return withTransaction(async (connection) => {
      const current = await TaxProfileRepository.findById(connection, id);
      if (current === null) throw new NotFoundError('Tax profile', id);
      const before = mapTaxProfile(current);

      const supplyType = input.supplyType ?? before.supplyType;
      const gstTaxability = input.gstTaxability ?? before.gstTaxability;
      assertRatesCoherent({
        gstTaxability,
        gstRate: input.gstRate ?? before.gstRate,
        cgstRate: input.cgstRate ?? before.cgstRate,
        sgstRate: input.sgstRate ?? before.sgstRate,
        igstRate: input.igstRate ?? before.igstRate,
      });

      const hsnSacId = input.hsnSacId !== undefined ? input.hsnSacId : before.hsnSacId;
      const classification = await this.resolveClassification(connection, hsnSacId, supplyType);

      const assignments: string[] = [];
      const params: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        assignments.push(`${column} = ?`);
        params.push(value);
      };

      if (input.code !== undefined) set('code', input.code);
      if (input.name !== undefined) set('name', input.name);
      if (input.description !== undefined) set('description', input.description);
      if (input.hsnSacId !== undefined) set('hsn_sac_id', input.hsnSacId);
      if (input.supplyType !== undefined) set('supply_type', input.supplyType);
      if (input.gstTaxability !== undefined) set('gst_taxability', input.gstTaxability);
      if (input.gstRate !== undefined) set('gst_rate', input.gstRate);
      if (input.cgstRate !== undefined) set('cgst_rate', input.cgstRate);
      if (input.sgstRate !== undefined) set('sgst_rate', input.sgstRate);
      if (input.igstRate !== undefined) set('igst_rate', input.igstRate);
      if (input.cessRate !== undefined) set('cess_rate', input.cessRate);
      if (input.priceIsInclusive !== undefined) {
        set('price_is_inclusive', input.priceIsInclusive ? 1 : 0);
      }
      if (input.itcEligibility !== undefined) set('itc_eligibility', input.itcEligibility);
      if (input.effectiveFrom !== undefined) set('effective_from', input.effectiveFrom);
      if (input.effectiveTo !== undefined) set('effective_to', input.effectiveTo);
      if (input.exemptionReason !== undefined) set('exemption_reason', input.exemptionReason);
      if (input.regulatoryNotes !== undefined) set('regulatory_notes', input.regulatoryNotes);
      if (input.status !== undefined) set('status', input.status);
      if (input.sortOrder !== undefined) set('sort_order', input.sortOrder);

      if (assignments.length > 0) {
        try {
          await TaxProfileRepository.update(connection, id, assignments, params);
        } catch (error) {
          if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
            throw new ConflictError(`A tax profile with code "${input.code ?? ''}" already exists`);
          }
          throw error;
        }
      }

      const updated = await TaxProfileRepository.findById(connection, id);
      if (updated === null) throw new NotFoundError('Tax profile', id);

      await auditService.record(connection, actor, {
        action: AuditAction.TAX_PROFILE_UPDATED,
        entityType: 'tax_profiles',
        entityId: id,
        before: { ...before },
        after: { ...mapTaxProfile(updated) },
      });
      if (classification?.isInactive === true && input.hsnSacId !== undefined) {
        await auditService.record(connection, actor, {
          action: AuditAction.TAX_HSN_OVERRIDDEN,
          entityType: 'tax_profiles',
          entityId: id,
          after: { hsnSacId, code: classification.code, reason: 'inactive code' },
        });
      }

      return mapTaxProfile(updated);
    });
  }

  /**
   * Soft-deletes a profile. Refused while any food item or variant still assigns it — the
   * caller is told to deactivate instead, which leaves existing assignments intact.
   */
  async deleteProfile(id: string, actor: AuditActor): Promise<void> {
    await withTransaction(async (connection) => {
      const current = await TaxProfileRepository.findById(connection, id);
      if (current === null) throw new NotFoundError('Tax profile', id);

      const references = await TaxProfileRepository.countReferences(connection, id);
      const total = references.foodItems + references.variants;
      if (total > 0) {
        throw new ConflictError(
          `This tax profile is assigned to ${references.foodItems} food item(s) and ` +
            `${references.variants} variant(s). Deactivate it instead of deleting it.`,
        );
      }

      await TaxProfileRepository.softDelete(connection, id);
      await auditService.record(connection, actor, {
        action: AuditAction.TAX_PROFILE_DELETED,
        entityType: 'tax_profiles',
        entityId: id,
        before: { ...mapTaxProfile(current) },
      });
    });
  }
}

export const taxService = new TaxService();
