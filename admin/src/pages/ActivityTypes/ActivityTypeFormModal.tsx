import { useState } from 'react';
import { LIMITS, MasterStatus, type ActivityTypeDto } from '@menuboard/shared';
import { InfoIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateActivityType, useUpdateActivityType } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  description: string;
  icon: string;
  status: MasterStatus;
  sortOrder: number;
}

const FORM_ID = 'activity-type-form';

export function ActivityTypeFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: ActivityTypeDto | null;
}): JSX.Element {
  const modalId = `activity-type-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        name: editing.name,
        description: editing.description ?? '',
        icon: editing.icon ?? '',
        status: editing.status,
        sortOrder: editing.sortOrder,
      }
    : { name: '', description: '', icon: '', status: MasterStatus.ACTIVE, sortOrder: 0 };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateActivityType();
  const update = useUpdateActivityType();
  const submitting = create.isPending || update.isPending;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const body = {
      name: value.name,
      description: value.description || null,
      icon: value.icon || null,
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
      id="activity-type-form"
      title={editing ? `Edit activity type — ${editing.name}` : 'New activity type'}
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
          {editing?.isSystem && (
            <Alert>
              <InfoIcon />
              <AlertDescription>
                This is a system-seeded activity type. It cannot be deleted, only deactivated.
              </AlertDescription>
            </Alert>
          )}

          <TextField
            label="Name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.ACTIVITY_NAME_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
          />
          <TextField
            label="Icon (name)"
            value={value.icon}
            onChange={(e) => setValue({ ...value, icon: e.target.value })}
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
