import { useEffect, useState } from 'react';
import { LIMITS, MasterStatus, type IngredientDto } from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { SearchPickerField } from '../../components/SearchPickerField';
import { ingredientCategoriesApi, ingredientsApi } from '../../api/ingredients';
import { useCreateIngredient, useIngredientUnits, useUpdateIngredient } from '../../hooks/useIngredients';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

interface FormValues {
  name: string;
  nameHi: string;
  unit: string;
  status: MasterStatus;
  sortOrder: number;
  categoryId: string;
  categoryLabel: string;
}

const FORM_ID = 'ingredient-form';

export function IngredientFormModal({
  open,
  onClose,
  editing,
  defaultCategoryId,
  defaultCategoryLabel,
}: {
  open: boolean;
  onClose: () => void;
  editing: IngredientDto | null;
  defaultCategoryId?: string;
  defaultCategoryLabel?: string;
}): JSX.Element {
  const modalId = `ingredient-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        nameHi: editing.nameHi ?? '',
        unit: editing.unit,
        status: editing.status,
        sortOrder: editing.sortOrder,
        categoryId: editing.categoryId ?? '',
        categoryLabel: editing.categoryName ?? defaultCategoryLabel ?? '',
      }
    : {
        name: '',
        nameHi: '',
        unit: '',
        status: MasterStatus.ACTIVE,
        sortOrder: 0,
        categoryId: defaultCategoryId ?? '',
        categoryLabel: defaultCategoryLabel ?? '',
      };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const create = useCreateIngredient();
  const update = useUpdateIngredient();
  const submitting = create.isPending || update.isPending;
  const { data: units } = useIngredientUnits();

  const { data: categoryOptions, isFetching } = useQuery({
    queryKey: ['ingredient-category-picker', categorySearch],
    queryFn: () =>
      ingredientCategoriesApi.list({ search: categorySearch || undefined, page: 1, pageSize: 20 }),
    enabled: open,
  });

  // Resolve the category label when editing from the unfiltered grid, so the picker does not
  // show a blank label for an already-set category.
  const { data: resolvedCategory } = useQuery({
    queryKey: ['ingredient-category-resolve', editing?.categoryId],
    queryFn: () => ingredientCategoriesApi.list({ page: 1, pageSize: 100 }),
    enabled: open && Boolean(editing?.categoryId) && !value.categoryLabel,
  });
  useEffect(() => {
    if (!resolvedCategory || value.categoryLabel) return;
    const match = resolvedCategory.items.find((c) => c.id === value.categoryId);
    if (match) setValue({ ...value, categoryLabel: match.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCategory]);

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

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const body = {
      name: value.name,
      nameHi: value.nameHi || null,
      unit: value.unit,
      categoryId: value.categoryId || null,
      status: value.status,
      sortOrder: value.sortOrder,
    };
    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="ingredient-form"
      title={editing ? `Edit ingredient — ${editing.name}` : 'New ingredient'}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.INGREDIENT_NAME_MAX}
          />

          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label="Name (Hindi)"
              value={value.nameHi}
              onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
              maxLength={LIMITS.INGREDIENT_NAME_MAX}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={translating || !value.name.trim()}
              onClick={onTranslate}
            >
              {translating ? 'Translating…' : 'Auto Translate →'}
            </Button>
          </div>

          <SearchPickerField
            id="ingredient-category"
            label="Category"
            value={value.categoryId || null}
            displayValue={value.categoryLabel}
            options={(categoryOptions?.items ?? []).map((c) => ({ id: c.id, label: c.name }))}
            loading={isFetching}
            onSearchChange={setCategorySearch}
            onSelect={(opt) => setValue({ ...value, categoryId: opt.id, categoryLabel: opt.label })}
          />

          <TextField
            label="Unit"
            required
            list="ingredient-unit-suggestions"
            value={value.unit}
            onChange={(e) => setValue({ ...value, unit: e.target.value })}
            maxLength={LIMITS.UNIT_MAX}
            helperText="e.g. kg, g, litre, pcs — type a new unit or pick an existing one"
          />
          <datalist id="ingredient-unit-suggestions">
            {(units ?? []).map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>

          <NumberField
            label="Sort order"
            value={value.sortOrder}
            onChange={(e) => setValue({ ...value, sortOrder: Number(e.target.value) })}
          />

          {editing && (
            <SelectField
              label="Status"
              value={value.status}
              onChange={(v) => setValue({ ...value, status: v as MasterStatus })}
              options={enumOptions(MasterStatus)}
            />
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
