import { useMemo, useState, type ReactNode } from 'react';
import {
  BatchIssuePolicy,
  Capability,
  LIMITS,
  MasterStatus,
  ProductKind,
  ValuationMethod,
  type CreateProductRequest,
  type ProductDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { HsnSacPicker } from '../Tax/HsnSacPicker';
import { ingredientsApi } from '../../api/ingredients';
import { useIngredientCategories } from '../../hooks/useIngredients';
import { useTaxProfiles } from '../../hooks/useTax';
import {
  useCreateProduct,
  useInventoryLocations,
  useUomOptions,
  useUpdateProduct,
  useVendors,
} from '../../hooks/usePurchase';
import { useAuth } from '../../services/AuthContext';
import { readError } from '../../services/errorMessage';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';
import { toProperCase } from '@/lib/textCase';
import { ProductLocationsPanel } from './ProductLocationsPanel';

const FORM_ID = 'product-form';

interface FormValues {
  name: string;
  nameHi: string;
  code: string;
  barcode: string;
  brand: string;
  description: string;
  categoryId: string;
  kind: ProductKind;

  hsnSacId: string;
  taxProfileId: string;

  stockUomId: string;
  purchaseUomId: string;
  purchaseConversionFactor: string;
  packSize: string;

  isBatchTracked: boolean;
  isExpiryTracked: boolean;
  shelfLifeDays: string;
  batchIssuePolicy: BatchIssuePolicy;

  valuationMethod: ValuationMethod;
  standardCost: string;

  defaultLocationId: string;
  preferredSupplierId: string;
  preferredSupplierLabel: string;
  minStock: string;
  reorderLevel: string;
  maxStock: string;
  leadTimeDays: string;
  isPurchasable: boolean;
  isStocked: boolean;

  sortOrder: string;
  status: MasterStatus;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const optionalNumber = (value: string): number | null => {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** A titled band of related fields. The product master is far too wide for one flat list. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="border-b pb-1.5">
        <h3 className="font-heading text-sm font-semibold">{title}</h3>
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function ProductFormModal({
  open,
  onClose,
  editing,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  editing: ProductDto | null;
  canWrite: boolean;
}): JSX.Element {
  const modalId = `product-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
      name: editing.name,
      nameHi: editing.nameHi ?? '',
      code: editing.code ?? '',
      barcode: editing.barcode ?? '',
      brand: editing.brand ?? '',
      description: editing.description ?? '',
      categoryId: editing.categoryId ?? '',
      kind: editing.kind,
      hsnSacId: editing.hsnSacId ?? '',
      taxProfileId: editing.taxProfileId ?? '',
      stockUomId: editing.stockUomId ?? '',
      purchaseUomId: editing.purchaseUomId ?? '',
      purchaseConversionFactor: String(editing.purchaseConversionFactor),
      packSize: editing.packSize ?? '',
      isBatchTracked: editing.isBatchTracked,
      isExpiryTracked: editing.isExpiryTracked,
      shelfLifeDays: editing.shelfLifeDays === null ? '' : String(editing.shelfLifeDays),
      batchIssuePolicy: editing.batchIssuePolicy,
      valuationMethod: editing.valuationMethod,
      standardCost: editing.standardCost === null ? '' : String(editing.standardCost),
      defaultLocationId: editing.defaultLocationId ?? '',
      preferredSupplierId: editing.preferredSupplierId ?? '',
      preferredSupplierLabel: editing.preferredSupplierName ?? '',
      minStock: editing.minStock === null ? '' : String(editing.minStock),
      reorderLevel: editing.reorderLevel === null ? '' : String(editing.reorderLevel),
      maxStock: editing.maxStock === null ? '' : String(editing.maxStock),
      leadTimeDays: editing.leadTimeDays === null ? '' : String(editing.leadTimeDays),
      isPurchasable: editing.isPurchasable,
      isStocked: editing.isStocked,
      sortOrder: String(editing.sortOrder),
      status: editing.status,
    }
    : {
      name: '',
      nameHi: '',
      code: '',
      barcode: '',
      brand: '',
      description: '',
      categoryId: '',
      kind: ProductKind.STOCK,
      hsnSacId: '',
      taxProfileId: '',
      stockUomId: '',
      purchaseUomId: '',
      purchaseConversionFactor: '1',
      packSize: '',
      isBatchTracked: false,
      isExpiryTracked: false,
      shelfLifeDays: '',
      batchIssuePolicy: BatchIssuePolicy.FEFO,
      valuationMethod: ValuationMethod.MOVING_AVERAGE,
      standardCost: '',
      defaultLocationId: '',
      preferredSupplierId: '',
      preferredSupplierLabel: '',
      minStock: '',
      reorderLevel: '',
      maxStock: '',
      leadTimeDays: '',
      isPurchasable: true,
      isStocked: true,
      sortOrder: '0',
      status: MasterStatus.ACTIVE,
    };

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [translating, setTranslating] = useState(false);

  const { hasCapability } = useAuth();
  const canReadTax = hasCapability(Capability.TAX_READ);
  // The vendor lookup sits behind PURCHASE_READ on the server; asking for it without the
  // capability would only produce a 403 behind an empty picker.
  const canReadVendors = hasCapability(Capability.PURCHASE_READ);
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const submitting = create.isPending || update.isPending;

  const { data: categories } = useIngredientCategories({ page: 1, pageSize: 100 });
  const { data: taxProfiles } = useTaxProfiles({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: uoms } = useUomOptions();
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: vendors, isFetching: vendorsFetching } = useVendors(
    { search: supplierSearch || undefined, page: 1, pageSize: 20, status: MasterStatus.ACTIVE },
    open && canReadVendors,
  );

  const uomOptions = useMemo(
    () =>
      toOptions(
        uoms?.items ?? [],
        (uom) => uom.id,
        (uom) => `${uom.code} — ${uom.name}`,
      ),
    [uoms?.items],
  );

  const stockCode = uoms?.items.find((uom) => uom.id === value.stockUomId)?.code ?? null;
  const purchaseCode = uoms?.items.find((uom) => uom.id === value.purchaseUomId)?.code ?? null;
  const factor = Number(value.purchaseConversionFactor);

  /**
   * The one line that stops a case of twelve being booked as twelve cases. Recomputed as the
   * operator types, because this is the field they get wrong most often.
   */
  const conversionHint =
    purchaseCode && stockCode && Number.isFinite(factor) && factor > 0
      ? `1 ${purchaseCode} = ${factor} ${stockCode}`
      : 'Pick both units to see what one purchase unit yields.';

  const isStandardValuation = value.valuationMethod === ValuationMethod.STANDARD;

  async function onTranslate(): Promise<void> {
    if (!value.name.trim()) return;
    setTranslating(true);
    try {
      const { translated } = await ingredientsApi.translate(value.name);
      setValue({ ...value, nameHi: translated });
    } catch (err) {
      notify.fromError(err);
    } finally {
      setTranslating(false);
    }
  }

  function validate(): Errors {
    const next: Errors = {};
    if (!value.name.trim()) next.name = 'A name is required.';
    if (!(Number.isFinite(factor) && factor > 0)) {
      next.purchaseConversionFactor = 'The conversion factor must be greater than zero.';
    }
    const min = optionalNumber(value.minStock);
    const max = optionalNumber(value.maxStock);
    if (min !== null && max !== null && max < min) {
      next.maxStock = 'Maximum stock cannot be below minimum stock.';
    }
    if (isStandardValuation && optionalNumber(value.standardCost) === null) {
      next.standardCost = 'A standard cost is required when the valuation method is STANDARD.';
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

    const body: CreateProductRequest = {
      // Normalised again here rather than trusted from state: a blur may never have fired if
      // the operator went straight from typing to a keyboard submit.
      name: toProperCase(value.name.trim()),
      nameHi: value.nameHi || null,
      code: value.code.trim() || null,
      barcode: value.barcode.trim() || null,
      brand: value.brand || null,
      description: value.description || null,
      categoryId: value.categoryId || null,
      kind: value.kind,

      hsnSacId: value.hsnSacId || null,
      taxProfileId: value.taxProfileId || null,

      stockUomId: value.stockUomId || null,
      purchaseUomId: value.purchaseUomId || null,
      purchaseConversionFactor: factor,
      packSize: value.packSize || null,
      // Recipes display the unit as text; keep it in step with the chosen stock unit.
      ...(stockCode ? { unit: stockCode } : {}),

      isBatchTracked: value.isBatchTracked,
      isExpiryTracked: value.isExpiryTracked,
      shelfLifeDays: value.isExpiryTracked ? optionalNumber(value.shelfLifeDays) : null,
      batchIssuePolicy: value.batchIssuePolicy,

      valuationMethod: value.valuationMethod,
      standardCost: isStandardValuation ? optionalNumber(value.standardCost) : null,

      defaultLocationId: value.defaultLocationId || null,
      preferredSupplierId: value.preferredSupplierId || null,
      minStock: optionalNumber(value.minStock),
      reorderLevel: optionalNumber(value.reorderLevel),
      maxStock: optionalNumber(value.maxStock),
      leadTimeDays: optionalNumber(value.leadTimeDays),
      isPurchasable: value.isPurchasable,
      isStocked: value.isStocked,

      sortOrder: num(value.sortOrder),
      ...(editing ? { status: value.status } : {}),
    };

    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: { ...body, expectedRevision: editing.revision },
        });
      } else {
        await create.mutateAsync(body);
      }
      notify.success('Product saved.');
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="product-form"
      title={editing ? `Edit product — ${editing.name}` : 'New product'}
      open={open}
      onClose={onClose}
      minWidth={640}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={submitting}
          disabled={!canWrite}
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-6">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Section title="Identity" description="What the item is and how it is found.">
          <FieldGroup>
            <FieldRow>
              <TextField
                label="Name"
                required
                autoFocus
                disabled={!canWrite}
                error={errors.name}
                value={value.name}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
                onBlur={() => setValue({ ...value, name: toProperCase(value.name) })}
                maxLength={LIMITS.PRODUCT_NAME_MAX}
                helperText="Proper Case — normalised automatically, e.g. black salt → Black Salt."
              />
              <div className="flex items-end gap-2">
                <TextField
                  className="flex-1"
                  label="Name (Hindi)"
                  disabled={!canWrite}
                  value={value.nameHi}
                  onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
                  maxLength={LIMITS.PRODUCT_NAME_MAX}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canWrite || translating || !value.name.trim()}
                  onClick={() => void onTranslate()}
                >
                  {translating ? '…' : 'हिंदी →'}
                </Button>
              </div>
            </FieldRow>

            <FieldRow>
              <TextField
                label="Code"
                disabled={!canWrite}
                error={errors.code}
                value={value.code}
                onChange={(e) => setValue({ ...value, code: e.target.value.replace(/\D/g, '') })}
                maxLength={6}
                helperText="Leave blank and the server allocates a unique 6-digit code drawn from the name and category."
              />
              <TextField
                label="Barcode"
                disabled={!canWrite}
                value={value.barcode}
                onChange={(e) => setValue({ ...value, barcode: e.target.value })}
                maxLength={LIMITS.PRODUCT_BARCODE_MAX}
                helperText="Scanned at goods receipt to resolve the product without typing."
              />
            </FieldRow>

            <FieldRow>
              <TextField
                label="Brand"
                disabled={!canWrite}
                value={value.brand}
                onChange={(e) => setValue({ ...value, brand: e.target.value })}
                maxLength={LIMITS.PRODUCT_BRAND_MAX}
              />
              <SelectField
                label="Category"
                disabled={!canWrite}
                value={value.categoryId}
                onChange={(next) => setValue({ ...value, categoryId: next })}
                emptyLabel="Uncategorised"
                options={toOptions(
                  categories?.items ?? [],
                  (category) => category.id,
                  (category) => category.name,
                )}
              />
            </FieldRow>

            <SelectField
              label="Kind"
              required
              disabled={!canWrite}
              value={value.kind}
              onChange={(next) => setValue({ ...value, kind: next as ProductKind })}
              options={enumOptions(ProductKind)}
              helperText="Only STOCK forms an inventory balance. SERVICE and EXPENSE let freight or a repair sit on the same bill as the goods."
            />

            <TextField
              label="Description"
              multiline
              rows={2}
              disabled={!canWrite}
              value={value.description}
              onChange={(e) => setValue({ ...value, description: e.target.value })}
              maxLength={LIMITS.PRODUCT_DESCRIPTION_MAX}
            />
          </FieldGroup>
        </Section>

        <Section
          title="Tax"
          description="Classification and the reusable treatment that cites it. Rates live on the profile."
        >
          <FieldGroup>
            {canReadTax ? (
              <HsnSacPicker
                value={value.hsnSacId || null}
                onChange={(next) => setValue({ ...value, hsnSacId: next ?? '' })}
                supplyType={value.kind === ProductKind.SERVICE ? 'SERVICE' : 'GOODS'}
                disabled={!canWrite}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                HSN/SAC classification is not visible to your role.
              </p>
            )}

            <SelectField
              label="Tax profile"
              disabled={!canWrite}
              value={value.taxProfileId}
              onChange={(next) => setValue({ ...value, taxProfileId: next })}
              emptyLabel="No profile"
              options={toOptions(
                taxProfiles?.items ?? [],
                (profile) => profile.id,
                (profile) => profile.name,
              )}
              helperText="Decides the rate charged on a purchase of this product."
            />
          </FieldGroup>
        </Section>

        <Section
          title="Units"
          description="What it is stocked in, what it is bought in, and how the two convert."
        >
          <FieldGroup>
            <FieldRow>
              <SelectField
                label="Stock unit"
                disabled={!canWrite}
                value={value.stockUomId}
                onChange={(next) => setValue({ ...value, stockUomId: next })}
                emptyLabel="Not set"
                options={uomOptions}
                helperText="The unit the balance is held in."
              />
              <SelectField
                label="Purchase unit"
                disabled={!canWrite}
                value={value.purchaseUomId}
                onChange={(next) => setValue({ ...value, purchaseUomId: next })}
                emptyLabel="Same as stock unit"
                options={uomOptions}
                helperText="What the supplier bills in — a CASE, a BAG, a CARTON."
              />
            </FieldRow>

            <FieldRow>
              <NumberField
                label="Conversion factor"
                required
                disabled={!canWrite}
                error={errors.purchaseConversionFactor}
                value={value.purchaseConversionFactor}
                onChange={(e) =>
                  setValue({ ...value, purchaseConversionFactor: e.target.value })
                }
                min={0}
                step="0.000001"
                helperText={conversionHint}
              />
              <TextField
                label="Pack size"
                disabled={!canWrite}
                value={value.packSize}
                onChange={(e) => setValue({ ...value, packSize: e.target.value })}
                maxLength={LIMITS.PRODUCT_PACK_SIZE_MAX}
                helperText="Free text as printed on the pack — 12 × 500 ml."
              />
            </FieldRow>
          </FieldGroup>
        </Section>

        <Section
          title="Batch & expiry"
          description="Whether each receipt is tracked as its own lot, and which lot is picked first."
        >
          <FieldGroup>
            <SwitchField
              label="Batch tracked"
              disabled={!canWrite}
              checked={value.isBatchTracked}
              onCheckedChange={(checked) => setValue({ ...value, isBatchTracked: checked })}
              helperText="Every receipt carries a batch number and is issued as its own lot."
            />

            <SwitchField
              label="Expiry tracked"
              disabled={!canWrite}
              checked={value.isExpiryTracked}
              onCheckedChange={(checked) => setValue({ ...value, isExpiryTracked: checked })}
              helperText="Receipts carry an expiry date and near-expiry stock is flagged."
            />

            {value.isExpiryTracked && (
              <NumberField
                label="Shelf life (days)"
                disabled={!canWrite}
                value={value.shelfLifeDays}
                onChange={(e) => setValue({ ...value, shelfLifeDays: e.target.value })}
                min={0}
                step="1"
                helperText="Used to suggest an expiry date when the supplier's docket does not print one."
              />
            )}

            {value.isBatchTracked && (
              <SelectField
                label="Batch issue policy"
                disabled={!canWrite}
                value={value.batchIssuePolicy}
                onChange={(next) =>
                  setValue({ ...value, batchIssuePolicy: next as BatchIssuePolicy })
                }
                options={enumOptions(BatchIssuePolicy)}
                helperText="FEFO for anything perishable; FIFO where receipt order is what matters."
              />
            )}
          </FieldGroup>
        </Section>

        <Section title="Valuation" description="How the stock on hand is costed.">
          <FieldGroup>
            <SelectField
              label="Valuation method"
              disabled={!canWrite}
              value={value.valuationMethod}
              onChange={(next) => setValue({ ...value, valuationMethod: next as ValuationMethod })}
              options={enumOptions(ValuationMethod)}
              helperText="Moving average suits a staple bought at a drifting price; FIFO suits perishables."
            />

            {isStandardValuation && (
              <NumberField
                label="Standard cost"
                required
                disabled={!canWrite}
                error={errors.standardCost}
                value={value.standardCost}
                onChange={(e) => setValue({ ...value, standardCost: e.target.value })}
                min={0}
                step="0.01"
                helperText="Fixed cost per stock unit. Variance against it is expensed on receipt."
              />
            )}

            {editing && (
              <p className="text-muted-foreground text-xs">
                Moving average {editing.movingAverageCost}
                {editing.lastPurchaseRate !== null
                  ? ` · last purchased at ${editing.lastPurchaseRate}`
                  : ''}
                . Maintained by receipts, not editable here.
              </p>
            )}
          </FieldGroup>
        </Section>

        <Section
          title="Planning"
          description="Where it lives, who supplies it, and when it needs reordering."
        >
          <FieldGroup>
            <FieldRow>
              <SelectField
                label="Default location"
                disabled={!canWrite}
                value={value.defaultLocationId}
                onChange={(next) => setValue({ ...value, defaultLocationId: next })}
                emptyLabel="No default"
                options={toOptions(
                  locations?.items ?? [],
                  (location) => location.id,
                  (location) => `${location.code} — ${location.name}`,
                )}
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

            <SearchPickerField
              id="product-preferred-supplier"
              label="Preferred supplier"
              disabled={!canWrite || !canReadVendors}
              value={value.preferredSupplierId || null}
              displayValue={value.preferredSupplierLabel}
              options={(vendors?.items ?? []).map((vendor) => ({
                id: vendor.id,
                label: vendor.name,
                sublabel: vendor.code,
              }))}
              loading={vendorsFetching}
              onSearchChange={setSupplierSearch}
              onSelect={(option) =>
                setValue({
                  ...value,
                  preferredSupplierId: option.id,
                  preferredSupplierLabel: option.label,
                })
              }
              onClear={() =>
                setValue({ ...value, preferredSupplierId: '', preferredSupplierLabel: '' })
              }
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <NumberField
                label="Minimum stock"
                disabled={!canWrite}
                value={value.minStock}
                onChange={(e) => setValue({ ...value, minStock: e.target.value })}
                min={0}
                step="0.001"
              />
              <NumberField
                label="Reorder level"
                disabled={!canWrite}
                value={value.reorderLevel}
                onChange={(e) => setValue({ ...value, reorderLevel: e.target.value })}
                min={0}
                step="0.001"
                helperText="At or below this, the product is proposed for purchase."
              />
              <NumberField
                label="Maximum stock"
                disabled={!canWrite}
                error={errors.maxStock}
                value={value.maxStock}
                onChange={(e) => setValue({ ...value, maxStock: e.target.value })}
                min={0}
                step="0.001"
              />
            </div>

            <SwitchField
              label="Purchasable"
              disabled={!canWrite}
              checked={value.isPurchasable}
              onCheckedChange={(checked) => setValue({ ...value, isPurchasable: checked })}
              helperText="Off hides it from the purchase order and entry pickers."
            />

            <SwitchField
              label="Stocked"
              disabled={!canWrite}
              checked={value.isStocked}
              onCheckedChange={(checked) => setValue({ ...value, isStocked: checked })}
              helperText="Off means it is expensed on receipt and never forms a balance."
            />

            <FieldRow>
              <NumberField
                label="Sort order"
                disabled={!canWrite}
                value={value.sortOrder}
                onChange={(e) => setValue({ ...value, sortOrder: e.target.value })}
              />
              {editing && (
                <SelectField
                  label="Status"
                  disabled={!canWrite}
                  value={value.status}
                  onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
                  options={enumOptions(MasterStatus)}
                  helperText="Deactivate rather than delete a product with movement history."
                />
              )}
            </FieldRow>
          </FieldGroup>
        </Section>

        {editing && <ProductLocationsPanel productId={editing.id} canWrite={canWrite} />}
      </form>
    </Modal>
  );
}
