import { useState } from 'react';
import { LIMITS, MasterStatus, type IngredientCategoryDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { ingredientsApi } from '../../api/ingredients';
import {
  useCreateIngredientCategory,
  useUpdateIngredientCategory,
} from '../../hooks/useIngredients';
import { readError } from '../../services/errorMessage';
import { notify } from '@/lib/notify';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  nameHi: string;
  status: MasterStatus;
  sortOrder: number;
}

const FORM_ID = 'ingredient-category-form';

export function IngredientCategoryFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: IngredientCategoryDto | null;
}): JSX.Element {
  const modalId = `ingredient-category-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        nameHi: editing.nameHi ?? '',
        status: editing.status,
        sortOrder: editing.sortOrder,
      }
    : { name: '', nameHi: '', status: MasterStatus.ACTIVE, sortOrder: 0 };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const create = useCreateIngredientCategory();
  const update = useUpdateIngredientCategory();
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
      name: value.name,
      nameHi: value.nameHi || null,
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
      id="ingredient-category-form"
      title={editing ? `Edit ingredient category — ${editing.name}` : 'New ingredient category'}
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
            maxLength={LIMITS.INGREDIENT_CATEGORY_NAME_MAX}
          />

          <div className="flex items-end gap-2">
            <TextField
              className="flex-1"
              label="Name (Hindi)"
              value={value.nameHi}
              onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
              maxLength={LIMITS.INGREDIENT_CATEGORY_NAME_MAX}
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
