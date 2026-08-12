import { useState } from 'react';
import { LIMITS, MasterStatus, type MenuDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateMenu, useUpdateMenu } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  code: string;
  name: string;
  description: string;
  status: MasterStatus;
  sortOrder: number;
  priority: number;
}

const FORM_ID = 'menu-form';

export function MenuFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: MenuDto | null;
}): JSX.Element {
  const modalId = `menu-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
      code: editing.code,
      name: editing.name,
      description: editing.description ?? '',
      status: editing.status,
      sortOrder: editing.sortOrder,
      priority: editing.priority,
    }
    : { code: '', name: '', description: '', status: MasterStatus.ACTIVE, sortOrder: 0, priority: 0 };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateMenu();
  const update = useUpdateMenu();
  const submitting = create.isPending || update.isPending;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: {
            code: value.code,
            name: value.name,
            description: value.description || null,
            status: value.status,
            sortOrder: value.sortOrder,
            priority: value.priority,
          },
        });
      } else {
        await create.mutateAsync({
          code: value.code,
          name: value.name,
          description: value.description || null,
          sortOrder: value.sortOrder,
          priority: value.priority,
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
      id="menu-form"
      title={editing ? `Edit menu — ${editing.name}` : 'New menu'}
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
            label="Code"
            helperText="Stable identifier — e.g. VSK, PUBLIC, SATSANGEE. Letters, digits, _ and - only."
            autoFocus
            required
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
            maxLength={LIMITS.MENU_CODE_MAX}
          />
          <TextField
            label="Menu name"
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.MENU_NAME_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={3}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            maxLength={LIMITS.MENU_DESCRIPTION_MAX}
          />
          <NumberField
            label="Priority"
            helperText="Higher priority menus can be surfaced first by a consuming client."
            value={value.priority}
            onChange={(e) => setValue({ ...value, priority: Number(e.target.value) })}
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
