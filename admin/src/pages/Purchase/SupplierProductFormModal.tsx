import { useMemo, useState } from 'react';
import {
  Capability,
  LIMITS,
  MasterStatus,
  type SupplierProductDto,
  type UpsertSupplierProductRequest,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FieldGroup,
  FieldRow,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { SearchPickerField } from '../../components/SearchPickerField';
import {
  useCreateSupplierProduct,
  useProducts,
  useUomOptions,
  useUpdateSupplierProduct,
  useVendors,
} from '../../hooks/usePurchase';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'supplier-product-form';

interface FormValues {
  supplierId: string;
  supplierLabel: string;
  productId: string;
  productLabel: string;
  productUnit: string;
  supplierSku: string;
  supplierProductName: string;
  barcode: string;
  purchaseUomId: string;
  conversionFactor: string;
  packSize: string;
  leadTimeDays: string;
  isPreferred: boolean;
  notes: string;
  status: MasterStatus;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const optionalNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function SupplierProductFormModal({
  open,
  onClose,
  editing,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  editing: SupplierProductDto | null;
  canWrite: boolean;
}): JSX.Element {
  const modalId = `supplier-product-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
      supplierId: editing.supplierId,
      supplierLabel: editing.supplierName ?? '',
      productId: editing.productId,
      productLabel: editing.productName ?? '',
      productUnit: editing.productUnit ?? '',
      supplierSku: editing.supplierSku ?? '',
      supplierProductName: editing.supplierProductName ?? '',
      barcode: editing.barcode ?? '',
      purchaseUomId: editing.purchaseUomId ?? '',
      conversionFactor: String(editing.conversionFactor),
      packSize: editing.packSize ?? '',
      leadTimeDays: editing.leadTimeDays === null ? '' : String(editing.leadTimeDays),
      isPreferred: editing.isPreferred,
      notes: editing.notes ?? '',
      status: editing.status,
    }
    : {
      supplierId: '',
      supplierLabel: '',
      productId: '',
      productLabel: '',
      productUnit: '',
      supplierSku: '',
      supplierProductName: '',
      barcode: '',
      purchaseUomId: '',
      conversionFactor: '1',
      packSize: '',
      leadTimeDays: '',
      isPreferred: false,
      notes: '',
      status: MasterStatus.ACTIVE,
    };

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

  const { hasCapability } = useAuth();
  // The vendor lookup is PURCHASE_READ on the server, not SUPPLIER_PRODUCT_MANAGE.
  const canReadVendors = hasCapability(Capability.PURCHASE_READ);
  const create = useCreateSupplierProduct();
  const update = useUpdateSupplierProduct();
  const submitting = create.isPending || update.isPending;

  const { data: vendors, isFetching: vendorsFetching } = useVendors(
    { search: supplierSearch || undefined, page: 1, pageSize: 20, status: MasterStatus.ACTIVE },
    open && canReadVendors,
  );
  // The product master is large, so this searches the server rather than filtering a
  // pre-loaded list — a plain select would either truncate it or fetch thousands of rows.
  const { data: products, isFetching: productsFetching } = useProducts({
    search: productSearch || undefined,
    page: 1,
    pageSize: 20,
    status: MasterStatus.ACTIVE,
    purchasableOnly: true,
  });
  const { data: uoms } = useUomOptions();

  const uomOptions = useMemo(
    () =>
      toOptions(
        uoms?.items ?? [],
        (uom) => uom.id,
        (uom) => `${uom.code} — ${uom.name}`,
      ),
    [uoms?.items],
  );

  const purchaseCode = uoms?.items.find((uom) => uom.id === value.purchaseUomId)?.code ?? null;
  const factor = Number(value.conversionFactor);
  const conversionHint =
    purchaseCode && value.productUnit && Number.isFinite(factor) && factor > 0
      ? `1 ${purchaseCode} = ${factor} ${value.productUnit}`
      : "How many of the product's stock units one of the supplier's units yields.";

  function validate(): Errors {
    const next: Errors = {};
    if (!value.supplierId) next.supplierId = 'Choose a supplier.';
    if (!value.productId) next.productId = 'Choose a product.';
    if (!(Number.isFinite(factor) && factor > 0)) {
      next.conversionFactor = 'The conversion factor must be greater than zero.';
    }
    return next;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setError('Some fields need attention.');
      return;
    }

    const body: UpsertSupplierProductRequest = {
      supplierId: value.supplierId,
      productId: value.productId,
      supplierSku: value.supplierSku.trim() || null,
      supplierProductName: value.supplierProductName.trim() || null,
      barcode: value.barcode.trim() || null,
      purchaseUomId: value.purchaseUomId || null,
      conversionFactor: factor,
      packSize: value.packSize || null,
      leadTimeDays: optionalNumber(value.leadTimeDays),
      isPreferred: value.isPreferred,
      notes: value.notes || null,
      ...(editing ? { status: value.status } : {}),
    };

    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      notify.success('Supplier product saved.');
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="supplier-product-form"
      title={
        editing
          ? `Edit supplier product — ${editing.productName ?? editing.supplierSku ?? ''}`
          : 'New supplier product'
      }
      open={open}
      onClose={onClose}
      minWidth={560}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={submitting}
          disabled={!canWrite}
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <SearchPickerField
            id="supplier-product-supplier"
            label="Supplier"
            required
            disabled={!canWrite || !canReadVendors || editing !== null}
            value={value.supplierId || null}
            displayValue={value.supplierLabel}
            options={(vendors?.items ?? []).map((vendor) => ({
              id: vendor.id,
              label: vendor.name,
              sublabel: vendor.gstin ?? vendor.code,
            }))}
            loading={vendorsFetching}
            onSearchChange={setSupplierSearch}
            onSelect={(option) =>
              setValue({ ...value, supplierId: option.id, supplierLabel: option.label })
            }
          />
          {errors.supplierId && <p className="text-destructive -mt-3 text-sm">{errors.supplierId}</p>}

          <SearchPickerField
            id="supplier-product-product"
            label="Product"
            required
            disabled={!canWrite || editing !== null}
            value={value.productId || null}
            displayValue={value.productLabel}
            options={(products?.items ?? []).map((product) => ({
              id: product.id,
              label: product.name,
              sublabel: [product.code, product.stockUomCode ?? product.unit]
                .filter(Boolean)
                .join(' · '),
            }))}
            loading={productsFetching}
            onSearchChange={setProductSearch}
            onSelect={(option) => {
              const picked = products?.items.find((product) => product.id === option.id);
              setValue({
                ...value,
                productId: option.id,
                productLabel: option.label,
                productUnit: picked?.stockUomCode ?? picked?.unit ?? '',
              });
            }}
          />
          {errors.productId && <p className="text-destructive -mt-3 text-sm">{errors.productId}</p>}

          <FieldRow>
            <TextField
              label="Supplier SKU"
              disabled={!canWrite}
              value={value.supplierSku}
              onChange={(e) => setValue({ ...value, supplierSku: e.target.value })}
              maxLength={LIMITS.SUPPLIER_SKU_MAX}
              helperText="What matching reads off a scanned bill to resolve this product."
            />
            <TextField
              label="Barcode"
              disabled={!canWrite}
              value={value.barcode}
              onChange={(e) => setValue({ ...value, barcode: e.target.value })}
              maxLength={LIMITS.PRODUCT_BARCODE_MAX}
            />
          </FieldRow>

          <TextField
            label="Supplier's name for it"
            disabled={!canWrite}
            value={value.supplierProductName}
            onChange={(e) => setValue({ ...value, supplierProductName: e.target.value })}
            maxLength={LIMITS.SUPPLIER_PRODUCT_NAME_MAX}
            helperText="As printed on their invoice, which is rarely what we call it."
          />

          <FieldRow>
            <SelectField
              label="Purchase unit"
              disabled={!canWrite}
              value={value.purchaseUomId}
              onChange={(next) => setValue({ ...value, purchaseUomId: next })}
              emptyLabel="Product default"
              options={uomOptions}
            />
            <NumberField
              label="Conversion factor"
              required
              disabled={!canWrite}
              error={errors.conversionFactor}
              value={value.conversionFactor}
              onChange={(e) => setValue({ ...value, conversionFactor: e.target.value })}
              min={0}
              step="0.000001"
              helperText={conversionHint}
            />
          </FieldRow>

          <FieldRow>
            <TextField
              label="Pack size"
              disabled={!canWrite}
              value={value.packSize}
              onChange={(e) => setValue({ ...value, packSize: e.target.value })}
              maxLength={LIMITS.PRODUCT_PACK_SIZE_MAX}
            />
            <NumberField
              label="Lead time (days)"
              disabled={!canWrite}
              value={value.leadTimeDays}
              onChange={(e) => setValue({ ...value, leadTimeDays: e.target.value })}
              min={0}
              step="1"
            />
          </FieldRow>

          <SwitchField
            label="Preferred supplier for this product"
            disabled={!canWrite}
            checked={value.isPreferred}
            onCheckedChange={(checked) => setValue({ ...value, isPreferred: checked })}
            helperText="Who a requirement turns into an order against by default."
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            disabled={!canWrite}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
            maxLength={500}
          />

          {editing && (
            <>
              <p className="text-muted-foreground text-xs">
                Last rate{' '}
                {editing.lastRate === null ? 'not recorded yet' : editing.lastRate}
                {editing.lastPurchasedAt
                  ? ` · last purchased ${new Date(editing.lastPurchasedAt).toLocaleDateString()}`
                  : ''}
                . Maintained by posted purchases.
              </p>
              <SelectField
                label="Status"
                disabled={!canWrite}
                value={value.status}
                onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
                options={enumOptions(MasterStatus)}
              />
            </>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
