import { useState } from 'react';
import { LIMITS, MasterStatus, type MenuCategoryDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { ingredientsApi } from '../../api/ingredients';
import { useCatalogueOptions } from '../../hooks/useMenuMaster';
import { useCreateMenuCategory, useUpdateMenuCategory } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';
import { enumOptions } from '@/lib/options';

interface FormValues {
  /** `''` means no catalogue — the category exists in the master but sits on no menu. */
  catalogueId: string;
  name: string;
  nameHi: string;
  description: string;
  status: MasterStatus;
  sortOrder: number;
}

const FORM_ID = 'menu-category-form';

export function MenuCategoryFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: MenuCategoryDto | null;
}): JSX.Element {
  const modalId = `menu-category-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
      catalogueId: editing.catalogueId ?? '',
      name: editing.name,
      nameHi: editing.nameHi ?? '',
      description: editing.description ?? '',
      status: editing.status,
      sortOrder: editing.sortOrder,
    }
    : {
      catalogueId: '',
      name: '',
      nameHi: '',
      description: '',
      status: MasterStatus.ACTIVE,
      sortOrder: 0,
    };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const { options: catalogueOptions, isLoading: cataloguesLoading } = useCatalogueOptions();
  const create = useCreateMenuCategory();
  const update = useUpdateMenuCategory();
  const submitting = create.isPending || update.isPending;

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
      catalogueId: value.catalogueId || null,
      name: value.name,
      nameHi: value.nameHi || null,
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
      id="menu-category-form"
      title={editing ? `Edit category — ${editing.name}` : 'New menu category'}
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

          <SelectField
            label="Menu Catalogue"
            helperText="The catalogue this category belongs to. A category belongs to one catalogue; leave it unassigned to keep it out of every menu for now."
            value={value.catalogueId}
            onChange={(v) => setValue({ ...value, catalogueId: v })}
            disabled={cataloguesLoading}
            emptyLabel="No catalogue"
            options={catalogueOptions}
          />
          <TextField
            label="Name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.MENU_CATEGORY_NAME_MAX}
          />
          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label="Name (Hindi)"
              value={value.nameHi}
              onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
              maxLength={LIMITS.MENU_CATEGORY_NAME_MAX}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={translating || !value.name.trim()}
              onClick={onTranslate}
            >
              {translating ? 'Translating…' : 'हिंदी →'}
            </Button>
          </div>
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
