import { useState } from 'react';
import { LIMITS, MasterStatus, type ItemGroupDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateItemGroup, useUpdateItemGroup } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  code: string;
  description: string;
  status: MasterStatus;
}

const FORM_ID = 'item-group-form';

export function ItemGroupFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: ItemGroupDto | null;
}): JSX.Element {
  const modalId = `item-group-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        code: editing.code ?? '',
        description: editing.description ?? '',
        status: editing.status,
      }
    : { name: '', code: '', description: '', status: MasterStatus.ACTIVE };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateItemGroup();
  const update = useUpdateItemGroup();
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
            code: value.code || null,
            description: value.description || null,
            status: value.status,
          },
        });
      } else {
        await create.mutateAsync({
          name: value.name,
          code: value.code || null,
          description: value.description || null,
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
      id="item-group-form"
      title={editing ? `Edit item group — ${editing.name}` : 'New item group'}
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
            helperText="e.g. À La Carte, Combo Eligible, Set Menu"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.COUNTER_NAME_MAX}
          />
          <TextField
            label="Code"
            helperText="Optional short code"
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value })}
            maxLength={60}
          />
          <TextField
            label="Description"
            multiline
            rows={3}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
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
