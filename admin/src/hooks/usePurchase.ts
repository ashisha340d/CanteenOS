import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MasterStatus } from '@menuboard/shared';
import type {
  CreateInventoryLocationRequest,
  CreateProductRequest,
  CreateUomRequest,
  InventoryLocationListQuery,
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
  inventoryLocationsApi,
  productsApi,
  supplierProductsApi,
  uomsApi,
  vendorsApi,
  type VendorListQuery,
} from '../api/purchase';

/* ------------------------------------------------------------------ units of measure */

export function useUoms(query: UomListQuery) {
  return useQuery({
    queryKey: ['uoms', query],
    queryFn: () => uomsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

/**
 * Every active unit in one list, for the pickers. The master is a few dozen rows at most, so
 * a paged picker would be ceremony — and both product forms need the same list to build the
 * "1 CASE = 12 NOS" hint, which needs the codes, not just the ids.
 */
export function useUomOptions() {
  return useQuery({
    queryKey: ['uoms', { picker: true }],
    queryFn: () => uomsApi.list({ page: 1, pageSize: 200, status: MasterStatus.ACTIVE }),
  });
}

/** A UOM change re-labels every product row, so the product lists go with it. */
function useInvalidateUoms() {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: ['uoms'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['supplier-products'] });
  };
}

export function useCreateUom() {
  const invalidate = useInvalidateUoms();
  return useMutation({
    mutationFn: (body: CreateUomRequest) => uomsApi.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateUom() {
  const invalidate = useInvalidateUoms();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUomRequest }) => uomsApi.update(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteUom() {
  const invalidate = useInvalidateUoms();
  return useMutation({
    mutationFn: (id: string) => uomsApi.remove(id),
    onSuccess: () => invalidate(),
  });
}

/* --------------------------------------------------------------- inventory locations */

export function useInventoryLocations(query: InventoryLocationListQuery) {
  return useQuery({
    queryKey: ['inventory-locations', query],
    queryFn: () => inventoryLocationsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useInventoryLocation(id: string | null) {
  return useQuery({
    queryKey: ['inventory-location', id],
    queryFn: () => inventoryLocationsApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

/** Locations are named on products and on the per-location stock policy, so both refresh. */
function useInvalidateInventoryLocations() {
  const qc = useQueryClient();
  return (id?: string): void => {
    void qc.invalidateQueries({ queryKey: ['inventory-locations'] });
    void qc.invalidateQueries({ queryKey: ['product-locations'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: ['inventory-location', id] });
  };
}

export function useCreateInventoryLocation() {
  const invalidate = useInvalidateInventoryLocations();
  return useMutation({
    mutationFn: (body: CreateInventoryLocationRequest) => inventoryLocationsApi.create(body),
    onSuccess: (location) => invalidate(location.id),
  });
}

export function useUpdateInventoryLocation() {
  const invalidate = useInvalidateInventoryLocations();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateInventoryLocationRequest }) =>
      inventoryLocationsApi.update(id, body),
    onSuccess: (location) => invalidate(location.id),
  });
}

export function useDeleteInventoryLocation() {
  const invalidate = useInvalidateInventoryLocations();
  return useMutation({
    mutationFn: (id: string) => inventoryLocationsApi.remove(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

/* -------------------------------------------------------------------- product master */

export function useProducts(query: ProductListQuery) {
  return useQuery({
    queryKey: ['products', query],
    queryFn: () => productsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useProduct(id: string | null) {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => productsApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

function useInvalidateProducts() {
  const qc = useQueryClient();
  return (id?: string): void => {
    void qc.invalidateQueries({ queryKey: ['products'] });
    void qc.invalidateQueries({ queryKey: ['supplier-products'] });
    if (id !== undefined) {
      void qc.invalidateQueries({ queryKey: ['product', id] });
      void qc.invalidateQueries({ queryKey: ['product-locations', id] });
    }
  };
}

export function useCreateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (body: CreateProductRequest) => productsApi.create(body),
    onSuccess: (product) => invalidate(product.id),
  });
}

export function useUpdateProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateProductRequest }) =>
      productsApi.update(id, body),
    onSuccess: (product) => invalidate(product.id),
  });
}

export function useDeleteProduct() {
  const invalidate = useInvalidateProducts();
  return useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

/* --------------------------------------------------------- per-location stock policy */

export function useProductLocations(productId: string | null) {
  return useQuery({
    queryKey: ['product-locations', productId],
    queryFn: () => productsApi.listLocations(productId as string),
    enabled: productId !== null && productId !== '',
  });
}

export function useUpsertProductLocation(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertProductLocationRequest) =>
      productsApi.upsertLocation(productId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-locations', productId] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProductLocation(productId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (locationId: string) => productsApi.removeLocation(productId, locationId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['product-locations', productId] });
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/* ------------------------------------------------------------ supplier ↔ product map */

export function useSupplierProducts(query: SupplierProductListQuery & { preferredOnly?: boolean }) {
  return useQuery({
    queryKey: ['supplier-products', query],
    queryFn: () => supplierProductsApi.list(query),
    placeholderData: (previous) => previous,
  });
}

/** The preferred supplier is denormalised onto the product, so products refresh with it. */
function useInvalidateSupplierProducts() {
  const qc = useQueryClient();
  return (): void => {
    void qc.invalidateQueries({ queryKey: ['supplier-products'] });
    void qc.invalidateQueries({ queryKey: ['products'] });
  };
}

export function useCreateSupplierProduct() {
  const invalidate = useInvalidateSupplierProducts();
  return useMutation({
    mutationFn: (body: UpsertSupplierProductRequest) => supplierProductsApi.create(body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateSupplierProduct() {
  const invalidate = useInvalidateSupplierProducts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UpsertSupplierProductRequest> }) =>
      supplierProductsApi.update(id, body),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteSupplierProduct() {
  const invalidate = useInvalidateSupplierProducts();
  return useMutation({
    mutationFn: (id: string) => supplierProductsApi.remove(id),
    onSuccess: () => invalidate(),
  });
}

/* ----------------------------------------------------------- vendor purchase profile */

export function useVendors(query: VendorListQuery, enabled = true) {
  return useQuery({
    queryKey: ['purchase-vendors', query],
    queryFn: () => vendorsApi.list(query),
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useVendor(entityId: string | null) {
  return useQuery({
    queryKey: ['purchase-vendor', entityId],
    queryFn: () => vendorsApi.get(entityId as string),
    enabled: entityId !== null && entityId !== '',
  });
}

export function useUpdateVendorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId, body }: { entityId: string; body: UpdateVendorProfileRequest }) =>
      vendorsApi.updateProfile(entityId, body),
    onSuccess: (vendor) => {
      void qc.invalidateQueries({ queryKey: ['purchase-vendors'] });
      void qc.invalidateQueries({ queryKey: ['purchase-vendor', vendor.id] });
    },
  });
}
