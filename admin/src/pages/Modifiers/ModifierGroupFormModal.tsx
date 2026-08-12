import { useState } from 'react';
import { LIMITS, MasterStatus, ModifierSelectionType, type ModifierGroupDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateModifierGroup, useUpdateModifierGroup } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  description: string;
  selectionType: ModifierSelectionType;
  minSelect: number;
  status: MasterStatus;
}

const FORM_ID = 'modifier-group-form';

export function ModifierGroupFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: ModifierGroupDto | null;
}): JSX.Element {
  const modalId = `modifier-group-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        description: editing.description ?? '',
        selectionType: editing.selectionType,
        minSelect: editing.minSelect,
        status: editing.status,
      }
    : {
        name: '',
        description: '',
        selectionType: ModifierSelectionType.MULTIPLE,
        minSelect: 0,
        status: MasterStatus.ACTIVE,
      };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateModifierGroup();
  const update = useUpdateModifierGroup();
  const submitting = create.isPending || update.isPending;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: {
            name: value.name,
            description: value.description || null,
            selectionType: value.selectionType,
            minSelect: value.minSelect,
            status: value.status,
          },
        });
      } else {
        await create.mutateAsync({
          name: value.name,
          description: value.description || null,
          selectionType: value.selectionType,
          minSelect: value.minSelect,
        });
      }
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="modifier-group-form"
      title={editing ? `Edit modifier group — ${editing.name}` : 'New modifier group'}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={submitting} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Group name"
            helperText="e.g. Toppings, Spice level, Size upgrade"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.MODIFIER_GROUP_NAME_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
          <SelectField
            label="Selection type"
            value={value.selectionType}
            onChange={(v) => setValue({ ...value, selectionType: v as ModifierSelectionType })}
            options={enumOptions(ModifierSelectionType)}
          />
          <NumberField
            label="Minimum selections required"
            value={value.minSelect}
            onChange={(e) => setValue({ ...value, minSelect: Number(e.target.value) })}
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
