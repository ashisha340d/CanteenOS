import { useState } from 'react';
import {
  LIMITS,
  MasterStatus,
  UomDimension,
  type CreateUomRequest,
  type UomDto,
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
import { useCreateUom, useUpdateUom } from '../../hooks/usePurchase';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { notify } from '@/lib/notify';

const FORM_ID = 'uom-form';

interface FormValues {
  code: string;
  name: string;
  dimension: UomDimension;
  isBase: boolean;
  factorToBase: string;
  decimalPlaces: string;
  sortOrder: string;
  status: MasterStatus;
}

type Errors = Partial<Record<keyof FormValues, string>>;

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function UomFormModal({
  open,
  onClose,
  editing,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  editing: UomDto | null;
  canWrite: boolean;
}): JSX.Element {
  const modalId = `uom-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        code: editing.code,
        name: editing.name,
        dimension: editing.dimension,
        isBase: editing.isBase,
        factorToBase: String(editing.factorToBase),
        decimalPlaces: String(editing.decimalPlaces),
        sortOrder: String(editing.sortOrder),
        status: editing.status,
      }
    : {
        code: '',
        name: '',
        dimension: UomDimension.COUNT,
        isBase: false,
        factorToBase: '1',
        decimalPlaces: '0',
        sortOrder: '0',
        status: MasterStatus.ACTIVE,
      };

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState<string | null>(null);
  const create = useCreateUom();
  const update = useUpdateUom();
  const submitting = create.isPending || update.isPending;

  function validate(): Errors {
    const next: Errors = {};
    if (!value.code.trim()) next.code = 'A code is required.';
    if (!value.name.trim()) next.name = 'A name is required.';
    const factor = num(value.factorToBase);
    if (!(factor > 0)) next.factorToBase = 'The factor to base must be greater than zero.';
    if (value.isBase && factor !== 1) {
      next.factorToBase = 'The base unit of a dimension converts to itself — its factor is 1.';
    }
    const decimals = num(value.decimalPlaces);
    if (decimals < 0 || decimals > 6 || !Number.isInteger(decimals)) {
      next.decimalPlaces = 'Decimals must be a whole number between 0 and 6.';
    }
    return next;
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body: CreateUomRequest = {
      code: value.code.trim().toUpperCase(),
      name: value.name.trim(),
      dimension: value.dimension,
      isBase: value.isBase,
      factorToBase: num(value.factorToBase),
      decimalPlaces: num(value.decimalPlaces),
      sortOrder: num(value.sortOrder),
      ...(editing ? { status: value.status } : {}),
    };

    try {
      if (editing) await update.mutateAsync({ id: editing.id, body });
      else await create.mutateAsync(body);
      notify.success('Unit saved.');
      clear();
      onClose();
    } catch (err) {
      setError(readError(err).message);
      notify.fromError(err);
    }
  }

  return (
    <Modal
      id="uom-form"
      title={editing ? `Edit unit — ${editing.code}` : 'New unit of measure'}
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
            maxLength={LIMITS.UOM_CODE_MAX}
            helperText="Short and printable — KG, GM, LTR, NOS, CASE."
            className="[&_input]:uppercase"
          />

          <TextField
            label="Name"
            required
            disabled={!canWrite}
            error={errors.name}
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.UOM_NAME_MAX}
          />

          <SelectField
            label="Dimension"
            required
            disabled={!canWrite}
            value={value.dimension}
            onChange={(next) => setValue({ ...value, dimension: next as UomDimension })}
            options={enumOptions(UomDimension)}
            helperText="Conversions only exist within one dimension. PACK units convert per product, not universally."
          />

          <SwitchField
            label="Base unit of this dimension"
            disabled={!canWrite}
            checked={value.isBase}
            onCheckedChange={(checked) =>
              setValue({ ...value, isBase: checked, factorToBase: checked ? '1' : value.factorToBase })
            }
            helperText="Exactly one unit per dimension is the base every other unit converts through."
          />

          <NumberField
            label="Factor to base"
            required
            disabled={!canWrite || value.isBase}
            error={errors.factorToBase}
            value={value.factorToBase}
            onChange={(e) => setValue({ ...value, factorToBase: e.target.value })}
            min={0}
            step="0.000001"
            helperText="How many base units one of this unit is worth. KG against a base of GM is 1000."
          />

          <NumberField
            label="Decimal places"
            disabled={!canWrite}
            error={errors.decimalPlaces}
            value={value.decimalPlaces}
            onChange={(e) => setValue({ ...value, decimalPlaces: e.target.value })}
            min={0}
            max={6}
            step="1"
            helperText="How a quantity in this unit is shown. NOS is 0, KG is 3."
          />

          <NumberField
            label="Sort order"
            disabled={!canWrite}
            value={value.sortOrder}
            onChange={(e) => setValue({ ...value, sortOrder: e.target.value })}
          />

          {editing && (
            <SelectField
              label="Status"
              disabled={!canWrite}
              value={value.status}
              onChange={(next) => setValue({ ...value, status: next as MasterStatus })}
              options={enumOptions(MasterStatus)}
              helperText="Deactivate rather than delete a unit already used by a product."
            />
          )}
        </FieldGroup>
      </form>
    </Modal>
  );
}
