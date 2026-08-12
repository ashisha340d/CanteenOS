import { useState } from 'react';
import { AvailabilityStatus, LIMITS, MasterStatus, type MenuItemAssignmentDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useUpdateMenuItemAssignment } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  displayName: string;
  displayNameHi: string;
  description: string;
  descriptionHi: string;
  preparationMethod: string;
  preparationMethodHi: string;
  preparationTimeMinutes: string;
  unit: string;
  status: MasterStatus;
  availability: AvailabilityStatus;
}

const FORM_ID = 'menu-item-assignment-form';

export function MenuItemAssignmentFormModal({
  open,
  onClose,
  assignment,
}: {
  open: boolean;
  onClose: () => void;
  assignment: MenuItemAssignmentDto | null;
}): JSX.Element | null {
  const modalId = `menu-item-assignment-form-${assignment?.id ?? 'none'}`;
  const initial: FormValues = {
    displayName: assignment?.displayName ?? '',
    displayNameHi: assignment?.displayNameHi ?? '',
    description: assignment?.description ?? '',
    descriptionHi: assignment?.descriptionHi ?? '',
    preparationMethod: assignment?.preparationMethod ?? '',
    preparationMethodHi: assignment?.preparationMethodHi ?? '',
    preparationTimeMinutes:
      assignment?.preparationTimeMinutes === null || assignment?.preparationTimeMinutes === undefined
        ? ''
        : String(assignment.preparationTimeMinutes),
    unit: assignment?.unit ?? '',
    status: assignment?.status ?? MasterStatus.ACTIVE,
    availability: assignment?.availability ?? AvailabilityStatus.AVAILABLE,
  };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateMenuItemAssignment();

  if (!assignment) return null;

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!assignment) return;
    try {
      await update.mutateAsync({
        id: assignment.id,
        body: {
          displayName: value.displayName || null,
          displayNameHi: value.displayNameHi || null,
          description: value.description || null,
          descriptionHi: value.descriptionHi || null,
          preparationMethod: value.preparationMethod || null,
          preparationMethodHi: value.preparationMethodHi || null,
          preparationTimeMinutes:
            value.preparationTimeMinutes === '' ? null : Number(value.preparationTimeMinutes),
          unit: value.unit || null,
          status: value.status,
          availability: value.availability,
        },
      });
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
    }
  }

  return (
    <Modal
      id="menu-item-assignment-form"
      title={`Edit — ${assignment.displayName ?? assignment.foodItemName ?? ''}`}
      open={open}
      onClose={onClose}
      footer={<FormModalFooter formId={FORM_ID} onCancel={onClose} submitting={update.isPending} />}
    >
      <form onSubmit={onSubmit} id={FORM_ID}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Display name"
            helperText={`Falls back to "${assignment.foodItemName ?? ''}" when left blank.`}
            value={value.displayName}
            onChange={(e) => setValue({ ...value, displayName: e.target.value })}
            maxLength={LIMITS.MENU_DISPLAY_NAME_MAX}
          />
          <TextField
            label="Display name (Hindi)"
            helperText={`Falls back to "${assignment.foodItemNameHi ?? ''}" when left blank.`}
            value={value.displayNameHi}
            onChange={(e) => setValue({ ...value, displayNameHi: e.target.value })}
            maxLength={LIMITS.MENU_DISPLAY_NAME_MAX}
          />
          <TextField
            label="Description on this menu"
            multiline
            rows={2}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            maxLength={LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX}
          />
          <TextField
            label="Description on this menu (Hindi)"
            multiline
            rows={2}
            value={value.descriptionHi}
            onChange={(e) => setValue({ ...value, descriptionHi: e.target.value })}
            maxLength={LIMITS.MENU_DESCRIPTION_OVERRIDE_MAX}
          />
          <TextField
            label="Preparation method on this menu"
            multiline
            rows={2}
            value={value.preparationMethod}
            onChange={(e) => setValue({ ...value, preparationMethod: e.target.value })}
            maxLength={LIMITS.PREPARATION_METHOD_MAX}
          />
          <TextField
            label="Preparation method on this menu (Hindi)"
            multiline
            rows={2}
            value={value.preparationMethodHi}
            onChange={(e) => setValue({ ...value, preparationMethodHi: e.target.value })}
            maxLength={LIMITS.PREPARATION_METHOD_MAX}
          />
          <NumberField
            label="Preparation time (minutes)"
            value={value.preparationTimeMinutes}
            onChange={(e) => setValue({ ...value, preparationTimeMinutes: e.target.value })}
          />
          <TextField
            label="Unit override"
            helperText={`Falls back to the food item's own unit when left blank.`}
            value={value.unit}
            onChange={(e) => setValue({ ...value, unit: e.target.value })}
            maxLength={LIMITS.UNIT_MAX}
          />
          <SelectField
            label="Availability"
            value={value.availability}
            onChange={(v) => setValue({ ...value, availability: v as AvailabilityStatus })}
            options={enumOptions(AvailabilityStatus)}
          />
          <SelectField
            label="Status"
            value={value.status}
            onChange={(v) => setValue({ ...value, status: v as MasterStatus })}
            options={enumOptions(MasterStatus)}
          />
        </FieldGroup>
      </form>

    </Modal>
  );
}
