import { useState } from 'react';
import {
  LIMITS,
  MasterStatus,
  type CreateStockCountRequest,
  type StockCountDto,
} from '@menuboard/shared';
import { XIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { FieldGroup, FieldRow, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { SearchPickerField } from '../../components/SearchPickerField';
import { useIngredientCategories } from '../../hooks/useIngredients';
import { useInventoryLocations, useProducts } from '../../hooks/usePurchase';
import { useCreateStockCount } from '../../hooks/useStock';
import { readError } from '../../services/errorMessage';
import { toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'stock-count-form';

type Scope = 'FULL' | 'CATEGORY' | 'PRODUCTS';

const SCOPE_OPTIONS = [
  { value: 'FULL', label: 'Full count — every product holding stock' },
  { value: 'CATEGORY', label: 'One category' },
  { value: 'PRODUCTS', label: 'A chosen list of products' },
];

interface FormValues {
  locationId: string;
  businessDate: string;
  scope: Scope;
  categoryId: string;
  products: { id: string; label: string }[];
  notes: string;
}

function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/**
 * Raising a count sheet. The lines are snapshotted server-side from the balances as they
 * stand at this moment, which is what the variance is later measured against — so the scope
 * chosen here is the whole of the decision.
 */
export function StockCountFormModal({
  open,
  canWrite,
  onClose,
  onCreated,
}: {
  open: boolean;
  canWrite: boolean;
  onClose: () => void;
  onCreated: (count: StockCountDto) => void;
}): JSX.Element {
  const initial: FormValues = {
    locationId: '',
    businessDate: today(),
    scope: 'FULL',
    categoryId: '',
    products: [],
    notes: '',
  };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(
    'stock-count-form',
    initial,
    open,
  );
  const [error, setError] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');

  const create = useCreateStockCount();
  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: categories } = useIngredientCategories({ page: 1, pageSize: 100 });
  const { data: products, isFetching: productsFetching } = useProducts({
    search: productSearch || undefined,
    page: 1,
    pageSize: 20,
    stockedOnly: true,
    status: MasterStatus.ACTIVE,
  });

  function validate(): string | null {
    if (!value.locationId) return 'Choose the location being counted.';
    if (value.scope === 'CATEGORY' && !value.categoryId) return 'Choose a category to count.';
    if (value.scope === 'PRODUCTS' && value.products.length === 0) {
      return 'Add at least one product to count.';
    }
    return null;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem !== null) return;

    const body: CreateStockCountRequest = {
      locationId: value.locationId,
      businessDate: value.businessDate || undefined,
      isFullCount: value.scope === 'FULL',
      notes: value.notes || null,
      ...(value.scope === 'CATEGORY' ? { categoryId: value.categoryId } : {}),
      ...(value.scope === 'PRODUCTS'
        ? { productIds: value.products.map((product) => product.id) }
        : {}),
    };

    try {
      const count = await create.mutateAsync(body);
      notify.success(`${count.countNumber} raised with ${count.lineCount ?? 0} lines.`);
      clear();
      onCreated(count);
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="stock-count-form"
      title="New stock count"
      open={open}
      onClose={onClose}
      minWidth={620}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={create.isPending}
          disabled={!canWrite}
          saveLabel="Raise count"
          savingLabel="Raising…"
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-5">
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <FieldGroup>
          <FieldRow>
            <SelectField
              label="Location"
              required
              disabled={!canWrite}
              value={value.locationId}
              onChange={(next) => setValue({ ...value, locationId: next })}
              options={toOptions(
                locations?.items ?? [],
                (location) => location.id,
                (location) => `${location.code} — ${location.name}`,
              )}
              helperText="One sheet counts one store."
            />
            <TextField
              label="Business date"
              type="date"
              disabled={!canWrite}
              value={value.businessDate}
              onChange={(event) => setValue({ ...value, businessDate: event.target.value })}
            />
          </FieldRow>

          <SelectField
            label="Scope"
            required
            disabled={!canWrite}
            value={value.scope}
            onChange={(next) => setValue({ ...value, scope: next as Scope })}
            options={SCOPE_OPTIONS}
            helperText="A full count snapshots every product holding stock at the location."
          />

          {value.scope === 'CATEGORY' && (
            <SelectField
              label="Category"
              required
              disabled={!canWrite}
              value={value.categoryId}
              onChange={(next) => setValue({ ...value, categoryId: next })}
              options={toOptions(
                categories?.items ?? [],
                (category) => category.id,
                (category) => category.name,
              )}
            />
          )}

          {value.scope === 'PRODUCTS' && (
            <div className="flex flex-col gap-2">
              <SearchPickerField
                id="count-add-product"
                label="Add a product"
                value={null}
                displayValue=""
                disabled={!canWrite}
                loading={productsFetching}
                onSearchChange={setProductSearch}
                options={(products?.items ?? []).map((product) => ({
                  id: product.id,
                  label: product.name,
                  sublabel: [product.code, product.stockUomCode ?? product.unit]
                    .filter(Boolean)
                    .join(' · '),
                }))}
                onSelect={(option) => {
                  if (value.products.some((product) => product.id === option.id)) return;
                  setValue({
                    ...value,
                    products: [...value.products, { id: option.id, label: option.label }],
                  });
                }}
              />
              {value.products.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Nothing chosen yet. The sheet will have one line per product added here.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {value.products.map((product) => (
                    <Badge key={product.id} variant="secondary" className="gap-1 pr-1">
                      {product.label}
                      <button
                        type="button"
                        aria-label={`Remove ${product.label}`}
                        className="focus-ring rounded-sm"
                        disabled={!canWrite}
                        onClick={() =>
                          setValue({
                            ...value,
                            products: value.products.filter((entry) => entry.id !== product.id),
                          })
                        }
                      >
                        <XIcon className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          )}

          <TextField
            label="Notes"
            multiline
            rows={2}
            disabled={!canWrite}
            value={value.notes}
            onChange={(event) => setValue({ ...value, notes: event.target.value })}
            maxLength={LIMITS.PURCHASE_NOTES_MAX}
          />
        </FieldGroup>
      </form>
    </Modal>
  );
}
