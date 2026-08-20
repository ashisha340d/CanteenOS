import { useState } from 'react';
import {
  InventoryLocationKind,
  LIMITS,
  MasterStatus,
  type CreateInventoryLocationRequest,
  type InventoryLocationDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  FieldGroup,
  NumberField,
  SelectField,
  SwitchField,
  TextField,
} from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCounters } from '../../hooks/useMenuMaster';
import { useStations } from '../../hooks/useMasters';
import {
  useCreateInventoryLocation,
  useInventoryLocations,
  useUpdateInventoryLocation,
} from '../../hooks/usePurchase';
import { readError } from '../../services/errorMessage';
import { enumOptions, toOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'inventory-location-form';

interface FormValues {
  code: string;
  name: string;
  nameHi: string;
  kind: InventoryLocationKind;
  parentId: string;
  department: string;
  counterId: string;
  stationId: string;
  isDefaultReceiving: boolean;
  allowsNegativeStock: boolean;
  sortOrder: string;
  notes: string;
  status: MasterStatus;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function InventoryLocationFormModal({
  open,
  onClose,
  editing,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  editing: InventoryLocationDto | null;
  canWrite: boolean;
}): JSX.Element {
  const modalId = `inventory-location-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        code: editing.code,
        name: editing.name,
        nameHi: editing.nameHi ?? '',
        kind: editing.kind,
        parentId: editing.parentId ?? '',
        department: editing.department ?? '',
        counterId: editing.counterId ?? '',
        stationId: editing.stationId ?? '',
        isDefaultReceiving: editing.isDefaultReceiving,
        allowsNegativeStock: editing.allowsNegativeStock,
        sortOrder: String(editing.sortOrder),
        notes: editing.notes ?? '',
        status: editing.status,
      }
    : {
        code: '',
        name: '',
        nameHi: '',
        kind: InventoryLocationKind.WAREHOUSE,
        parentId: '',
        department: '',
        counterId: '',
        stationId: '',
        isDefaultReceiving: false,
        allowsNegativeStock: false,
        sortOrder: '0',
        notes: '',
        status: MasterStatus.ACTIVE,
      };

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const create = useCreateInventoryLocation();
  const update = useUpdateInventoryLocation();
  const submitting = create.isPending || update.isPending;

  const { data: locations } = useInventoryLocations({
    page: 1,
    pageSize: 100,
    status: MasterStatus.ACTIVE,
  });
  const { data: counters } = useCounters({ page: 1, pageSize: 100, status: MasterStatus.ACTIVE });
  const { data: stations } = useStations({ page: 1, pageSize: 100, status: MasterStatus.ACTIVE });

  const isDirectConsumption = value.kind === InventoryLocationKind.DIRECT_CONSUMPTION;

  function validate(): Errors {
    const next: Errors = {};
    if (!value.code.trim()) next.code = 'A code is required.';
    if (!value.name.trim()) next.name = 'A name is required.';
    if (editing && value.parentId === editing.id) {
      next.parentId = 'A location cannot be its own parent.';
    }
    return next;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: CreateInventoryLocationRequest = {
      code: value.code.trim().toUpperCase(),
      name: value.name.trim(),
      nameHi: value.nameHi || null,
      kind: value.kind,
      parentId: value.parentId || null,
      counterId: value.counterId || null,
      stationId: value.stationId || null,
      department: value.department || null,
      // A location that never holds a balance cannot go negative either.
      isDefaultReceiving: value.isDefaultReceiving,
      allowsNegativeStock: isDirectConsumption ? false : value.allowsNegativeStock,
      sortOrder: num(value.sortOrder),
      notes: value.notes || null,
      ...(editing ? { status: value.status } : {}),
    };

    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          body: { ...body, expectedRevision: editing.revision },
        });
      } else {
        await create.mutateAsync(body);
      }
      notify.success('Location saved.');
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="inventory-location-form"
      title={editing ? `Edit location — ${editing.name}` : 'New inventory location'}
      open={open}
      onClose={onClose}
      footer={
        <FormModalFooter
          formId={FORM_ID}
          onCancel={onClose}
          submitting={submitting}
          disabled={!canWrite}
        />
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit}>
        <FieldGroup>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <TextField
            label="Code"
            required
            autoFocus
            disabled={!canWrite}
            error={errors.code}
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value.toUpperCase() })}
            maxLength={LIMITS.INVENTORY_LOCATION_CODE_MAX}
            className="[&_input]:uppercase"
          />

          <TextField
            label="Name"
            required
            disabled={!canWrite}
            error={errors.name}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.INVENTORY_LOCATION_NAME_MAX}
          />

          <TextField
            label="Name (Hindi)"
            disabled={!canWrite}
            value={value.nameHi}
            onChange={(e) => setValue({ ...value, nameHi: e.target.value })}
            maxLength={LIMITS.INVENTORY_LOCATION_NAME_MAX}
          />

          <SelectField
            label="Kind"
            required
            disabled={!canWrite}
            value={value.kind}
            onChange={(next) => setValue({ ...value, kind: next as InventoryLocationKind })}
            options={enumOptions(InventoryLocationKind)}
            helperText={
              isDirectConsumption
                ? 'Direct consumption expenses goods on arrival — it never holds a balance.'
                : 'A warehouse stages goods for dispatch; a day store or kitchen is consumed in place.'
            }
          />

          <SelectField
            label="Parent location"
            disabled={!canWrite}
            error={errors.parentId}
            value={value.parentId}
            onChange={(next) => setValue({ ...value, parentId: next })}
            emptyLabel="No parent"
            options={toOptions(
              (locations?.items ?? []).filter((location) => location.id !== editing?.id),
              (location) => location.id,
              (location) => `${location.code} — ${location.name}`,
            )}
          />

          <TextField
            label="Department"
            disabled={!canWrite}
            value={value.department}
            onChange={(e) => setValue({ ...value, department: e.target.value })}
            maxLength={LIMITS.ENTITY_DEPARTMENT_MAX}
            helperText="Which department this store's consumption is charged against."
          />

          <SelectField
            label="Counter"
            disabled={!canWrite}
            value={value.counterId}
            onChange={(next) => setValue({ ...value, counterId: next })}
            emptyLabel="No counter"
            options={toOptions(
              counters?.items ?? [],
              (counter) => counter.id,
              (counter) => counter.name,
            )}
          />

          <SelectField
            label="Station"
            disabled={!canWrite}
            value={value.stationId}
            onChange={(next) => setValue({ ...value, stationId: next })}
            emptyLabel="No station"
            options={toOptions(
              stations?.items ?? [],
              (station) => station.id,
              (station) => station.name,
            )}
          />

          <SwitchField
            label="Default receiving location"
            disabled={!canWrite}
            checked={value.isDefaultReceiving}
            onCheckedChange={(checked) => setValue({ ...value, isDefaultReceiving: checked })}
            helperText="Where a goods receipt lands when nothing more specific applies. At most one location."
          />

          <SwitchField
            label="Allows negative stock"
            disabled={!canWrite || isDirectConsumption}
            checked={isDirectConsumption ? false : value.allowsNegativeStock}
            onCheckedChange={(checked) => setValue({ ...value, allowsNegativeStock: checked })}
            helperText={
              isDirectConsumption
                ? 'Not applicable — direct consumption never carries a balance.'
                : 'On for a kitchen, where paperwork trails the cooking. Off for a warehouse, where negative means miscounted.'
            }
          />

          <NumberField
            label="Sort order"
            disabled={!canWrite}
            value={value.sortOrder}
            onChange={(e) => setValue({ ...value, sortOrder: e.target.value })}
          />

          <TextField
            label="Notes"
            multiline
            rows={2}
            disabled={!canWrite}
            value={value.notes}
            onChange={(e) => setValue({ ...value, notes: e.target.value })}
            maxLength={500}
          />

          {editing && (
            <SelectField
              label="Status"
              disabled={!canWrite}
              value={value.status}
              onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
              options={enumOptions(MasterStatus)}
              helperText="Deactivate rather than delete a location that already holds movements."
            />
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
