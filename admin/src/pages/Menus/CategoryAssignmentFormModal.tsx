import { useState } from 'react';
import { LIMITS, MasterStatus, type MenuCategoryAssignmentDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useUpdateMenuCategoryAssignment } from '../../hooks/useMenuMaster';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  displayName: string;
  displayNameHi: string;
  description: string;
  descriptionHi: string;
  status: MasterStatus;
  posVisible: boolean;
  boardVisible: boolean;
}

const FORM_ID = 'menu-category-assignment-form';

export function CategoryAssignmentFormModal({
  open,
  onClose,
  menuId,
  assignment,
}: {
  open: boolean;
  onClose: () => void;
  menuId: string;
  assignment: MenuCategoryAssignmentDto | null;
}): JSX.Element | null {
  const modalId = `menu-category-assignment-form-${assignment?.id ?? 'none'}`;
  const initial: FormValues = {
    displayName: assignment?.displayName ?? '',
    displayNameHi: assignment?.displayNameHi ?? '',
    description: assignment?.description ?? '',
    descriptionHi: assignment?.descriptionHi ?? '',
    status: assignment?.status ?? MasterStatus.ACTIVE,
    posVisible: assignment?.posVisible ?? true,
    boardVisible: assignment?.boardVisible ?? true,
  };
  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const update = useUpdateMenuCategoryAssignment(menuId);

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
          status: value.status,
          posVisible: value.posVisible,
          boardVisible: value.boardVisible,
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
      id="menu-category-assignment-form"
      title={`Edit — ${assignment.displayName ?? assignment.categoryName ?? ''}`}
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
            helperText={`Falls back to "${assignment.categoryName ?? ''}" when left blank.`}
            value={value.displayName}
            onChange={(e) => setValue({ ...value, displayName: e.target.value })}
            maxLength={LIMITS.MENU_DISPLAY_NAME_MAX}
          />
          <TextField
            label="Display name (Hindi)"
            helperText={`Falls back to "${assignment.categoryNameHi ?? ''}" when left blank.`}
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
          <SwitchField
            label="Visible on POS"
            checked={value.posVisible}
            onCheckedChange={(checked) => setValue({ ...value, posVisible: checked })}
          />
          <SwitchField
            label="Visible on MenuBoard"
            checked={value.boardVisible}
            onCheckedChange={(checked) => setValue({ ...value, boardVisible: checked })}
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
