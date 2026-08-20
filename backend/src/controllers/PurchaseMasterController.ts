import type { Request, Response } from 'express';
import type {
  CreateInventoryLocationRequest,
  CreateProductRequest,
  CreateUomRequest,
  InventoryLocationListQuery,
  MasterStatus,
  ProductListQuery,
  SupplierProductListQuery,
  UomListQuery,
  UpdateInventoryLocationRequest,
  UpdateProductRequest,
  UpdateUomRequest,
  UpdateVendorProfileRequest,
  UpsertProductLocationRequest,
  UpsertSupplierProductRequest,
} from '@menuboard/shared';
import {
  inventoryLocationService,
  productService,
  supplierProductService,
  uomService,
  vendorProfileService,
} from '../services/PurchaseMasterService';
import { created, noContent, ok, paginated } from '../utils/http';
import { actorFrom } from './context';

/**
 * Purchase master data. HTTP in, HTTP out — every rule lives in PurchaseMasterService.
 */
export const PurchaseMasterController = {
  /* ------------------------------------------------------- units of measure */

  async listUoms(req: Request, res: Response): Promise<void> {
    paginated(res, await uomService.list(req.query as unknown as UomListQuery));
  },

  async createUom(req: Request, res: Response): Promise<void> {
    created(res, await uomService.create(req.body as CreateUomRequest, actorFrom(req)));
  },

  async updateUom(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await uomService.update(
        req.params.uomId as string,
        req.body as UpdateUomRequest,
        actorFrom(req),
      ),
    );
  },

  async removeUom(req: Request, res: Response): Promise<void> {
    await uomService.remove(req.params.uomId as string, actorFrom(req));
    noContent(res);
  },

  /* ---------------------------------------------------- inventory locations */

  async listLocations(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await inventoryLocationService.list(req.query as unknown as InventoryLocationListQuery),
    );
  },

  async getLocation(req: Request, res: Response): Promise<void> {
    ok(res, await inventoryLocationService.getById(req.params.locationId as string));
  },

  async createLocation(req: Request, res: Response): Promise<void> {
    created(
      res,
      await inventoryLocationService.create(
        req.body as CreateInventoryLocationRequest,
        actorFrom(req),
      ),
    );
  },

  async updateLocation(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await inventoryLocationService.update(
        req.params.locationId as string,
        req.body as UpdateInventoryLocationRequest,
        actorFrom(req),
      ),
    );
  },

  async removeLocation(req: Request, res: Response): Promise<void> {
    await inventoryLocationService.remove(req.params.locationId as string, actorFrom(req));
    noContent(res);
  },

  /* --------------------------------------------------------- product master */

  async listProducts(req: Request, res: Response): Promise<void> {
    paginated(res, await productService.list(req.query as unknown as ProductListQuery));
  },

  async getProduct(req: Request, res: Response): Promise<void> {
    ok(res, await productService.getById(req.params.productId as string));
  },

  async createProduct(req: Request, res: Response): Promise<void> {
    created(res, await productService.create(req.body as CreateProductRequest, actorFrom(req)));
  },

  async updateProduct(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await productService.update(
        req.params.productId as string,
        req.body as UpdateProductRequest,
        actorFrom(req),
      ),
    );
  },

  async removeProduct(req: Request, res: Response): Promise<void> {
    await productService.remove(req.params.productId as string, actorFrom(req));
    noContent(res);
  },

  /* ------------------------------------------- per-location stock policy */

  async listProductLocations(req: Request, res: Response): Promise<void> {
    ok(res, await productService.listLocations(req.params.productId as string));
  },

  async upsertProductLocation(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await productService.upsertLocation(
        req.params.productId as string,
        req.body as UpsertProductLocationRequest,
        actorFrom(req),
      ),
    );
  },

  async removeProductLocation(req: Request, res: Response): Promise<void> {
    await productService.removeLocation(
      req.params.productId as string,
      req.params.locationId as string,
      actorFrom(req),
    );
    noContent(res);
  },

  /* -------------------------------------------------- supplier ↔ product map */

  async listSupplierProducts(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await supplierProductService.list(req.query as unknown as SupplierProductListQuery),
    );
  },

  /**
   * Upsert, so 201 only when a mapping genuinely came into existence; re-saving an existing
   * pairing answers 200 with the row as it now stands.
   */
  async upsertSupplierProduct(req: Request, res: Response): Promise<void> {
    const result = await supplierProductService.upsert(
      req.body as UpsertSupplierProductRequest,
      actorFrom(req),
    );
    if (result.created) created(res, result.dto);
    else ok(res, result.dto);
  },

  async updateSupplierProduct(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await supplierProductService.update(
        req.params.supplierProductId as string,
        req.body as Partial<UpsertSupplierProductRequest>,
        actorFrom(req),
      ),
    );
  },

  async removeSupplierProduct(req: Request, res: Response): Promise<void> {
    await supplierProductService.remove(req.params.supplierProductId as string, actorFrom(req));
    noContent(res);
  },

  /* --------------------------------------------------- vendor purchase profile */

  async listVendors(req: Request, res: Response): Promise<void> {
    paginated(
      res,
      await vendorProfileService.list(
        req.query as unknown as { page?: number; pageSize?: number; search?: string; status?: MasterStatus },
      ),
    );
  },

  async getVendor(req: Request, res: Response): Promise<void> {
    ok(res, await vendorProfileService.getById(req.params.entityId as string));
  },

  async updateVendorProfile(req: Request, res: Response): Promise<void> {
    ok(
      res,
      await vendorProfileService.updateProfile(
        req.params.entityId as string,
        req.body as UpdateVendorProfileRequest,
        actorFrom(req),
      ),
    );
  },
};
