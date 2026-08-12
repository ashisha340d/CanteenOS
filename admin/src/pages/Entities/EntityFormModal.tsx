import { useState } from 'react';
import { EntityType, LIMITS, MasterStatus, type EntityDto, type EntityWriteRequest } from '@menuboard/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { SearchPickerField } from '../../components/SearchPickerField';
import { usersApi } from '../../api/users';
import { useCreateEntity, useUpdateEntity } from '../../hooks/useEntities';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';

interface FormValues {
  type: EntityType;
  name: string;
  nameHi: string;
  code: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  stateCode: string;
  gstin: string;
  pan: string;
  department: string;
  designation: string;
  linkedUserId: string;
  linkedUserLabel: string;
  discountPercent: string;
  creditLimit: string;
  notes: string;
  sortOrder: string;
  status: MasterStatus;
}

const FORM_ID = 'entity-form';

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function EntityFormModal({
  open,
  onClose,
  editing,
  defaultType,
}: {
  open: boolean;
  onClose: () => void;
  editing: EntityDto | null;
  defaultType?: EntityType;
}): JSX.Element {
  const modalId = `entity-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        type: editing.type,
        name: editing.name,
        nameHi: editing.nameHi ?? '',
        code: editing.code,
        phone: editing.phone ?? '',
        email: editing.email ?? '',
        city: editing.city ?? '',
        address: editing.address ?? '',
        stateCode: editing.stateCode ?? '',
        gstin: editing.gstin ?? '',
        pan: editing.pan ?? '',
        department: editing.department ?? '',
        designation: editing.designation ?? '',
        linkedUserId: editing.linkedUserId ?? '',
        linkedUserLabel: editing.linkedUserName ?? '',
        discountPercent: String(editing.discountPercent),
        creditLimit: String(editing.creditLimit),
        notes: editing.notes ?? '',
        sortOrder: String(editing.sortOrder),
        status: editing.status,
      }
    : {
        type: defaultType ?? EntityType.CUSTOMER,
        name: '',
        nameHi: '',
        code: '',
        phone: '',
        email: '',
        city: '',
        address: '',
        stateCode: '',
        gstin: '',
        pan: '',
        department: '',
        designation: '',
        linkedUserId: '',
        linkedUserLabel: '',
        discountPercent: '0',
        creditLimit: '0',
        notes: '',
        sortOrder: '0',
        status: MasterStatus.ACTIVE,
      };

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const create = useCreateEntity();
  const update = useUpdateEntity();
  const submitting = create.isPending || update.isPending;

  const isEmployee = value.type === EntityType.EMPLOYEE;

  const { data: userOptions, isFetching: usersFetching } = useQuery({
    queryKey: ['entity-linked-user-picker', userSearch],
    queryFn: () => usersApi.list({ search: userSearch || undefined, page: 1, pageSize: 20 }),
    enabled: open && isEmployee,
  });

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const body: EntityWriteRequest = {
      type: value.type,
      name: value.name,
      nameHi: value.nameHi || null,
      phone: value.phone || null,
      email: value.email || null,
      address: value.address || null,
      city: value.city || null,
      stateCode: value.stateCode || null,
      gstin: value.gstin || null,
      pan: value.pan || null,
      // Hidden for every other type, so carrying a stale value through would be invisible.
      department: isEmployee ? value.department || null : null,
      designation: isEmployee ? value.designation || null : null,
      linkedUserId: isEmployee ? value.linkedUserId || null : null,
      discountPercent: num(value.discountPercent),
      creditLimit: num(value.creditLimit),
      notes: value.notes || null,
      sortOrder: num(value.sortOrder),
      ...(value.code.trim() ? { code: value.code.trim() } : {}),
      ...(editing ? { status: value.status } : {}),
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
      id="entity-form"
      title={editing ? `Edit entity — ${editing.name}` : 'New entity'}
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

          <SelectField
            label="Type"
            helperText="Decides which of the fields below apply — an employee carries a department, a vendor carries a GSTIN."
            required
            value={value.type}
            onChange={(v) => setValue({ ...value, type: v as EntityType })}
            options={enumOptions(EntityType)}
          />

          <TextField
            label="Name"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.ENTITY_NAME_MAX}
          />

          <TextField
            label="Name (Hindi)"
            value={value.nameHi}
            onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
            maxLength={LIMITS.ENTITY_NAME_MAX}
          />

          <TextField
            label="Code"
            helperText="Leave blank and the server allocates one — CUS-0001 for a customer, EMP-0001 for an employee, VEN-0001 for a vendor."
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value })}
            maxLength={LIMITS.ENTITY_CODE_MAX}
          />

          <TextField
            label="Phone"
            type="tel"
            helperText="What the counter searches on to find a returning customer."
            value={value.phone}
            onChange={(e) => setValue({ ...value, phone: e.target.value })}
            maxLength={LIMITS.ENTITY_PHONE_MAX}
          />

          <TextField
            label="Email"
            type="email"
            value={value.email}
            onChange={(e) => setValue({ ...value, email: e.target.value })}
            maxLength={LIMITS.ENTITY_EMAIL_MAX}
          />

          <TextField
            label="City"
            value={value.city}
            onChange={(e) => setValue({ ...value, city: e.target.value })}
            maxLength={LIMITS.ENTITY_CITY_MAX}
          />

          <TextField
            label="Address"
            multiline
            rows={2}
            value={value.address}
            onChange={(e) => setValue({ ...value, address: e.target.value })}
            maxLength={LIMITS.ENTITY_ADDRESS_MAX}
          />

          <TextField
            label="State code"
            helperText="Two-digit GST state code. Decides whether the till charges CGST+SGST or IGST."
            value={value.stateCode}
            onChange={(e) => setValue({ ...value, stateCode: e.target.value })}
            maxLength={2}
          />

          <TextField
            label="GSTIN"
            helperText="For GST-registered parties only — a walk-in customer has neither this nor a PAN."
            value={value.gstin}
            onChange={(e) => setValue({ ...value, gstin: e.target.value.toUpperCase() })}
            maxLength={LIMITS.ENTITY_GSTIN_MAX}
            className="[&_input]:uppercase"
          />

          <TextField
            label="PAN"
            helperText="For GST-registered parties only."
            value={value.pan}
            onChange={(e) => setValue({ ...value, pan: e.target.value.toUpperCase() })}
            maxLength={LIMITS.ENTITY_PAN_MAX}
            className="[&_input]:uppercase"
          />

          {isEmployee && (
            <>
              <TextField
                label="Department"
                helperText="Which department a subsidised meal is charged against."
                value={value.department}
                onChange={(e) => setValue({ ...value, department: e.target.value })}
                maxLength={LIMITS.ENTITY_DEPARTMENT_MAX}
              />

              <TextField
                label="Designation"
                value={value.designation}
                onChange={(e) => setValue({ ...value, designation: e.target.value })}
                maxLength={LIMITS.ENTITY_DESIGNATION_MAX}
              />

              <SearchPickerField
                id="entity-linked-user"
                label="Linked user"
                value={value.linkedUserId || null}
                displayValue={value.linkedUserLabel}
                options={(userOptions?.items ?? []).map((u) => ({
                  id: u.id,
                  label: u.name,
                  sublabel: u.username,
                }))}
                loading={usersFetching}
                onSearchChange={setUserSearch}
                onSelect={(opt) =>
                  setValue({ ...value, linkedUserId: opt.id, linkedUserLabel: opt.label })
                }
              />
              <p className="text-muted-foreground -mt-2 text-xs">
                Connects this employee to their login account, so a staff meal charged at the
                counter and the account that raised it resolve to one person.
              </p>
            </>
          )}

          <NumberField
            label="Discount %"
            helperText="Applied automatically to every line of this entity's POS orders."
            value={value.discountPercent}
            onChange={(e) => setValue({ ...value, discountPercent: e.target.value })}
            min={0}
            max={LIMITS.POS_DISCOUNT_PERCENT_MAX}
            step="0.01"
          />

          <NumberField
            label="Credit limit"
            helperText="Ceiling on the unsettled account balance. Zero means no credit is extended."
            value={value.creditLimit}
            onChange={(e) => setValue({ ...value, creditLimit: e.target.value })}
            min={0}
            step="0.01"
          />

          {editing && (
            <p className="text-muted-foreground text-xs">
              Current account balance {currency.format(editing.accountBalance)} — maintained by
              ACCOUNT settlements and not editable here.
            </p>
          )}

          <TextField
            label="Notes"
            multiline
            rows={2}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
            maxLength={LIMITS.ENTITY_NOTES_MAX}
          />

          <NumberField
            label="Sort order"
            value={value.sortOrder}
            onChange={(e) => setValue({ ...value, sortOrder: e.target.value })}
          />

          {editing && (
            <SelectField
              label="Status"
              helperText="Deactivate rather than delete an entity that already appears on POS orders."
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
