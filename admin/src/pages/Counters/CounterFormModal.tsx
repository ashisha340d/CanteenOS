import { useState } from 'react';
import { LIMITS, MasterStatus, MediaEntityType, type CounterDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldLabel } from '@/components/ui/field';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { SingleMediaPicker } from '@/components/MediaPicker/SingleMediaPicker';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateCounter, useUpdateCounter } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  code: string;
  description: string;
  status: MasterStatus;
}

const FORM_ID = 'counter-form';

export function CounterFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: CounterDto | null;
}): JSX.Element {
  const modalId = `counter-form-${editing?.id ?? 'new'}`;
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
  const create = useCreateCounter();
  const update = useUpdateCounter();
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
      id="counter-form"
      title={editing ? `Edit counter — ${editing.name}` : 'New counter'}
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
            label="Counter name"
            helperText="e.g. VSK Counter, Main Counter"
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
          {editing && (
            <Field>
              <FieldLabel>Image</FieldLabel>
              <SingleMediaPicker entityType={MediaEntityType.COUNTER} entityId={editing.id} />
            </Field>
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
