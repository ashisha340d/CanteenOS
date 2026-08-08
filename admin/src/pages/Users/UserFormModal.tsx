import { useEffect, useState } from 'react';
import { LIMITS, UserRole, UserStatus, type UserDto } from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, FieldRow, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateUser, useUpdateUser } from '../../hooks/useUsers';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  employeeCode: string;
  name: string;
  username: string;
  phone: string;
  email: string;
  password: string;
  role: UserRole;
  status: UserStatus;
}

const EMPTY: FormValues = {
  employeeCode: '',
  name: '',
  username: '',
  phone: '',
  email: '',
  password: '',
  role: UserRole.USER,
  status: UserStatus.ACTIVE,
};

const FORM_ID = 'user-form';

export function UserFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: UserDto | null;
}): JSX.Element {
  const modalId = 'user-form';
  const initial: FormValues = editing
    ? {
        employeeCode: editing.employeeCode ?? '',
        name: editing.name,
        username: editing.username,
        phone: editing.phone ?? '',
        email: editing.email ?? '',
        password: '',
        role: editing.role,
        status: editing.status,
      }
    : EMPTY;
  const { value, setValue, clear } = usePersistedFormState<FormValues>(
    `${modalId}-${editing?.id ?? 'new'}`,
    initial,
    open,
  );
  const [error, setError] = useState<string | null>(null);
  const create = useCreateUser();
  const update = useUpdateUser();
  const submitting = create.isPending || update.isPending;

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: {
            employeeCode: value.employeeCode || null,
            name: value.name,
            phone: value.phone || null,
            email: value.email || null,
            role: value.role,
            status: value.status,
            ...(value.password ? { password: value.password } : {}),
          },
        });
      } else {
        await create.mutateAsync({
          employeeCode: value.employeeCode || null,
          name: value.name,
          username: value.username,
          phone: value.phone || null,
          email: value.email || null,
          password: value.password,
          role: value.role,
          status: value.status,
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
      id={modalId}
      title={editing ? `Edit user — ${editing.name}` : 'New user'}
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
            label="Name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.USER_NAME_MAX}
          />
          <TextField
            label="Username"
            required
            disabled={Boolean(editing)}
            value={value.username}
            onChange={(e) => setValue({ ...value, username: e.target.value })}
            maxLength={LIMITS.USERNAME_MAX}
            helperText={
              editing
                ? 'Username cannot be changed.'
                : 'Letters, digits, dot, underscore or hyphen.'
            }
          />

          <FieldRow>
            <TextField
              label="Employee code"
              value={value.employeeCode}
              onChange={(e) => setValue({ ...value, employeeCode: e.target.value })}
            />
            <TextField
              label="Phone"
              type="tel"
              value={value.phone}
              onChange={(e) => setValue({ ...value, phone: e.target.value })}
            />
          </FieldRow>

          <TextField
            label="Email"
            type="email"
            value={value.email}
            onChange={(e) => setValue({ ...value, email: e.target.value })}
          />

          <TextField
            label={editing ? 'Reset password (leave blank to keep current)' : 'Password'}
            type="password"
            autoComplete="new-password"
            required={!editing}
            value={value.password}
            onChange={(e) => setValue({ ...value, password: e.target.value })}
            helperText={
              editing
                ? 'Setting a password here forces the user to change it again at next sign-in.'
                : `At least ${LIMITS.PASSWORD_MIN} characters.`
            }
          />

          <FieldRow>
            <SelectField
              label="Role"
              value={value.role}
              onChange={(v) => setValue({ ...value, role: v as UserRole })}
              options={enumOptions(UserRole)}
            />
            <SelectField
              label="Status"
              value={value.status}
              onChange={(v) => setValue({ ...value, status: v as UserStatus })}
              options={enumOptions(UserStatus)}
            />
          </FieldRow>
        </FieldGroup>
      </form>
    </Modal>
  );
}
