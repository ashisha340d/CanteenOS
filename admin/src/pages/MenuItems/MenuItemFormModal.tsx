import { useEffect, useState } from 'react';
import { LIMITS, MasterStatus, type MenuItemDto } from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { SearchPickerField } from '../../components/SearchPickerField';
import { menuCategoriesApi } from '../../api/masters';
import { useCreateMenuItem, useUpdateMenuItem } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  unit: string;
  description: string;
  status: MasterStatus;
  sortOrder: number;
  categoryId: string;
  categoryLabel: string;
}

const FORM_ID = 'menu-item-form';

export function MenuItemFormModal({
  open,
  onClose,
  editing,
  defaultCategoryId,
  defaultCategoryLabel,
}: {
  open: boolean;
  onClose: () => void;
  editing: MenuItemDto | null;
  defaultCategoryId?: string;
  defaultCategoryLabel?: string;
}): JSX.Element {
  const modalId = `menu-item-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        unit: editing.unit,
        description: '',
        status: editing.status,
        sortOrder: editing.sortOrder,
        categoryId: editing.categoryId,
        categoryLabel: defaultCategoryLabel ?? '',
      }
    : {
        name: '',
        unit: '',
        description: '',
        status: MasterStatus.ACTIVE,
        sortOrder: 0,
        categoryId: defaultCategoryId ?? '',
        categoryLabel: defaultCategoryLabel ?? '',
      };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState('');
  const create = useCreateMenuItem();
  const update = useUpdateMenuItem();
  const submitting = create.isPending || update.isPending;

  const { data: categoryOptions, isFetching } = useQuery({
    queryKey: ['menu-category-picker', categorySearch],
    queryFn: () =>
      menuCategoriesApi.list({ search: categorySearch || undefined, page: 1, pageSize: 20 }),
    enabled: open,
  });

  // When editing an item opened from the unfiltered grid, resolve its category's display
  // name once so the picker doesn't show a blank label for an already-set category.
  const { data: resolvedCategory } = useQuery({
    queryKey: ['menu-category-resolve', editing?.categoryId],
    queryFn: () => menuCategoriesApi.list({ page: 1, pageSize: 100 }),
    enabled: open && Boolean(editing) && !defaultCategoryLabel,
  });
  useEffect(() => {
    if (!resolvedCategory || value.categoryLabel) return;
    const match = resolvedCategory.items.find((c) => c.id === value.categoryId);
    if (match) setValue({ ...value, categoryLabel: match.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedCategory]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!value.categoryId) {
      setError('Choose a category first.');
      return;
    }
    const body = {
      name: value.name,
      categoryId: value.categoryId,
      unit: value.unit,
      description: value.description || null,
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
      id="menu-item-form"
      title={editing ? `Edit menu item — ${editing.name}` : 'New menu item'}
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
            maxLength={LIMITS.MENU_ITEM_NAME_MAX}
          />

          <SearchPickerField
            id="menu-item-category"
            label="Category"
            value={value.categoryId || null}
            displayValue={value.categoryLabel}
            options={(categoryOptions?.items ?? []).map((c) => ({ id: c.id, label: c.name }))}
            loading={isFetching}
            onSearchChange={setCategorySearch}
            onSelect={(opt) => setValue({ ...value, categoryId: opt.id, categoryLabel: opt.label })}
            required
          />

          <TextField
            label="Unit"
            required
            value={value.unit}
            onChange={(e) => setValue({ ...value, unit: e.target.value })}
            maxLength={LIMITS.UNIT_MAX}
            helperText="e.g. kg, plate, litre"
          />

          <TextField
            label="Description"
            multiline
            rows={2}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />

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
