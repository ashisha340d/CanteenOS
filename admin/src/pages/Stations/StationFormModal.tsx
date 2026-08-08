import { useState } from 'react';
import { LIMITS, MasterStatus, type StationDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateStation, useUpdateStation } from '../../hooks/useMasters';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  name: string;
  code: string;
  description: string;
  status: MasterStatus;
}

const FORM_ID = 'station-form';

export function StationFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: StationDto | null;
}): JSX.Element {
  const modalId = `station-form-${editing?.id ?? 'new'}`;
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
  const create = useCreateStation();
  const update = useUpdateStation();
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
      id="station-form"
      title={editing ? `Edit station — ${editing.name}` : 'New station'}
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
            label="Station name"
            helperText="The physical site — e.g. Barsana, Mangarh"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.STATION_NAME_MAX}
          />
          <TextField
            label="Code"
            helperText="Optional short code or slug"
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value })}
            maxLength={LIMITS.STATION_CODE_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={3}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            maxLength={LIMITS.STATION_DESCRIPTION_MAX}
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
