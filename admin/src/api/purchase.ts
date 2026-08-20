import type {
  CreateInventoryLocationRequest,
  CreateProductRequest,
  CreateUomRequest,
  InventoryLocationDto,
  InventoryLocationListQuery,
  MasterStatus,
  PageQuery,
  ProductDto,
  ProductListQuery,
  ProductLocationDto,
  SupplierProductDto,
  SupplierProductListQuery,
  UomDto,
  UomListQuery,
  UpdateInventoryLocationRequest,
  UpdateProductRequest,
  UpdateUomRequest,
  UpdateVendorProfileRequest,
  UpsertProductLocationRequest,
  UpsertSupplierProductRequest,
  VendorSummaryDto,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

const BASE = '/purchase';

export interface VendorListQuery extends PageQuery {
  status?: MasterStatus;
}

export const uomsApi = {
  list: (query: UomListQuery) => unwrapPaged<UomDto>(http.get(`${BASE}/uoms`, { params: query })),
  create: (body: CreateUomRequest) => unwrap<UomDto>(http.post(`${BASE}/uoms`, body)),
  update: (id: string, body: UpdateUomRequest) =>
    unwrap<UomDto>(http.patch(`${BASE}/uoms/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`${BASE}/uoms/${id}`)),
};

export const inventoryLocationsApi = {
  list: (query: InventoryLocationListQuery) =>
    unwrapPaged<InventoryLocationDto>(http.get(`${BASE}/locations`, { params: query })),
  get: (id: string) => unwrap<InventoryLocationDto>(http.get(`${BASE}/locations/${id}`)),
  create: (body: CreateInventoryLocationRequest) =>
    unwrap<InventoryLocationDto>(http.post(`${BASE}/locations`, body)),
  update: (id: string, body: UpdateInventoryLocationRequest) =>
    unwrap<InventoryLocationDto>(http.patch(`${BASE}/locations/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`${BASE}/locations/${id}`)),
};

export const productsApi = {
  list: (query: ProductListQuery) =>
    unwrapPaged<ProductDto>(http.get(`${BASE}/products`, { params: query })),
  get: (id: string) => unwrap<ProductDto>(http.get(`${BASE}/products/${id}`)),
  create: (body: CreateProductRequest) => unwrap<ProductDto>(http.post(`${BASE}/products`, body)),
  update: (id: string, body: UpdateProductRequest) =>
    unwrap<ProductDto>(http.patch(`${BASE}/products/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`${BASE}/products/${id}`)),

  listLocations: (productId: string) =>
    unwrap<ProductLocationDto[]>(http.get(`${BASE}/products/${productId}/locations`)),
  upsertLocation: (productId: string, body: UpsertProductLocationRequest) =>
    unwrap<ProductLocationDto>(http.put(`${BASE}/products/${productId}/locations`, body)),
  removeLocation: (productId: string, locationId: string) =>
    unwrap<null>(http.delete(`${BASE}/products/${productId}/locations/${locationId}`)),
};

export const supplierProductsApi = {
  list: (query: SupplierProductListQuery & { preferredOnly?: boolean }) =>
    unwrapPaged<SupplierProductDto>(http.get(`${BASE}/supplier-products`, { params: query })),
  create: (body: UpsertSupplierProductRequest) =>
    unwrap<SupplierProductDto>(http.post(`${BASE}/supplier-products`, body)),
  update: (id: string, body: Partial<UpsertSupplierProductRequest>) =>
    unwrap<SupplierProductDto>(http.patch(`${BASE}/supplier-products/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`${BASE}/supplier-products/${id}`)),
};

export const vendorsApi = {
  list: (query: VendorListQuery) =>
    unwrapPaged<VendorSummaryDto>(http.get(`${BASE}/vendors`, { params: query })),
  get: (entityId: string) => unwrap<VendorSummaryDto>(http.get(`${BASE}/vendors/${entityId}`)),
  updateProfile: (entityId: string, body: UpdateVendorProfileRequest) =>
    unwrap<VendorSummaryDto>(http.patch(`${BASE}/vendors/${entityId}/profile`, body)),
};
