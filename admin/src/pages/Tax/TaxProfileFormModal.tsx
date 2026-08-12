import { useState } from 'react';
import {
  GstTaxability,
  ItcEligibility,
  LIMITS,
  MasterStatus,
  SupplyType,
  ZERO_TAX_TAXABILITIES,
  type TaxProfileDto,
} from '@menuboard/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FieldGroup, NumberField, SelectField, SwitchField, TextField } from '@/components/form/fields';
import { FormModalFooter } from '@/components/form/FormModalFooter';
import { Modal } from '../../components/Modal/Modal';
import { usePersistedFormState } from '../../components/Modal/modalState';
import { useCreateTaxProfile, useUpdateTaxProfile } from '../../hooks/useTax';
import { readError } from '../../services/errorMessage';
import { enumOptions } from '@/lib/options';
import { HsnSacPicker } from './HsnSacPicker';

interface FormValues {
  code: string;
  name: string;
  description: string;
  hsnSacId: string | null;
  supplyType: SupplyType;
  gstTaxability: GstTaxability;
  gstRate: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cessRate: string;
  priceIsInclusive: boolean;
  itcEligibility: ItcEligibility;
  effectiveFrom: string;
  effectiveTo: string;
  exemptionReason: string;
  regulatoryNotes: string;
  status: MasterStatus;
}

const FORM_ID = 'tax-profile-form';

const EMPTY: FormValues = {
  code: '',
  name: '',
  description: '',
  hsnSacId: null,
  supplyType: SupplyType.SERVICE,
  gstTaxability: GstTaxability.TAXABLE,
  gstRate: '0',
  cgstRate: '0',
  sgstRate: '0',
  igstRate: '0',
  cessRate: '0',
  priceIsInclusive: true,
  itcEligibility: ItcEligibility.NOT_AVAILABLE,
  effectiveFrom: '',
  effectiveTo: '',
  exemptionReason: '',
  regulatoryNotes: '',
  status: MasterStatus.ACTIVE,
};

const num = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function TaxProfileFormModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: TaxProfileDto | null;
}): JSX.Element {
  const modalId = `tax-profile-form-${editing?.id ?? 'new'}`;
  const initial: FormValues = editing
    ? {
        code: editing.code,
        name: editing.name,
        description: editing.description ?? '',
        hsnSacId: editing.hsnSacId,
        supplyType: editing.supplyType,
        gstTaxability: editing.gstTaxability,
        gstRate: String(editing.gstRate),
        cgstRate: String(editing.cgstRate),
        sgstRate: String(editing.sgstRate),
        igstRate: String(editing.igstRate),
        cessRate: String(editing.cessRate),
        priceIsInclusive: editing.priceIsInclusive,
        itcEligibility: editing.itcEligibility,
        effectiveFrom: editing.effectiveFrom ?? '',
        effectiveTo: editing.effectiveTo ?? '',
        exemptionReason: editing.exemptionReason ?? '',
        regulatoryNotes: editing.regulatoryNotes ?? '',
        status: editing.status,
      }
    : EMPTY;

  const { value, setValue, clear } = usePersistedFormState<FormValues>(modalId, initial, open);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateTaxProfile();
  const update = useUpdateTaxProfile();
  const submitting = create.isPending || update.isPending;

  const untaxed = ZERO_TAX_TAXABILITIES.includes(value.gstTaxability);

  /**
   * The headline rate drives the split, because CGST/SGST/IGST are not independent facts —
   * they are the same tax expressed three ways, and the backend rejects any other combination.
   */
  function setGstRate(next: string): void {
    const half = (num(next) / 2).toString();
    setValue({ ...value, gstRate: next, cgstRate: half, sgstRate: half, igstRate: next });
  }

  function setTaxability(next: GstTaxability): void {
    if (ZERO_TAX_TAXABILITIES.includes(next)) {
      setValue({
        ...value,
        gstTaxability: next,
        gstRate: '0',
        cgstRate: '0',
        sgstRate: '0',
        igstRate: '0',
      });
      return;
    }
    setValue({ ...value, gstTaxability: next });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const body = {
      code: value.code,
      name: value.name,
      description: value.description || null,
      hsnSacId: value.hsnSacId,
      supplyType: value.supplyType,
      gstTaxability: value.gstTaxability,
      gstRate: num(value.gstRate),
      cgstRate: num(value.cgstRate),
      sgstRate: num(value.sgstRate),
      igstRate: num(value.igstRate),
      cessRate: num(value.cessRate),
      priceIsInclusive: value.priceIsInclusive,
      itcEligibility: value.itcEligibility,
      effectiveFrom: value.effectiveFrom || null,
      effectiveTo: value.effectiveTo || null,
      exemptionReason: value.exemptionReason || null,
      regulatoryNotes: value.regulatoryNotes || null,
      status: value.status,
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
      id="tax-profile-form"
      title={editing ? `Edit tax profile — ${editing.name}` : 'New tax profile'}
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
            label="Profile name"
            helperText="e.g. Restaurant Service 5%"
            autoFocus
            required
            value={value.name}
            onChange={(e) => setValue({ ...value, name: e.target.value })}
            maxLength={LIMITS.TAX_PROFILE_NAME_MAX}
          />
          <TextField
            label="Code"
            helperText="Short unique key, e.g. RESTAURANT_5"
            required
            value={value.code}
            onChange={(e) => setValue({ ...value, code: e.target.value })}
            maxLength={LIMITS.TAX_PROFILE_CODE_MAX}
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            value={value.description}
            onChange={(e) => setValue({ ...value, description: e.target.value })}
            maxLength={LIMITS.TAX_PROFILE_DESCRIPTION_MAX}
          />

          <SelectField
            label="Supply type"
            helperText="Services classify against SAC, goods against HSN."
            value={value.supplyType}
            onChange={(v) =>
              setValue({ ...value, supplyType: v as SupplyType, hsnSacId: null })
            }
            options={enumOptions(SupplyType)}
          />

          <HsnSacPicker
            value={value.hsnSacId}
            onChange={(id) => setValue({ ...value, hsnSacId: id })}
            supplyType={value.supplyType}
          />

          <SelectField
            label="GST taxability"
            value={value.gstTaxability}
            onChange={(v) => setTaxability(v as GstTaxability)}
            options={enumOptions(GstTaxability)}
          />

          <NumberField
            label="GST rate (%)"
            helperText={
              untaxed
                ? 'Fixed at 0% for this taxability.'
                : 'Sets CGST and SGST to half each, and IGST to the same value.'
            }
            disabled={untaxed}
            value={value.gstRate}
            onChange={(e) => setGstRate(e.target.value)}
            min={0}
            max={LIMITS.TAX_RATE_MAX}
            step="0.001"
          />
          <NumberField
            label="CGST rate (%)"
            disabled={untaxed}
            value={value.cgstRate}
            onChange={(e) => setValue({ ...value, cgstRate: e.target.value })}
            min={0}
            max={LIMITS.TAX_RATE_MAX}
            step="0.001"
          />
          <NumberField
            label="SGST rate (%)"
            disabled={untaxed}
            value={value.sgstRate}
            onChange={(e) => setValue({ ...value, sgstRate: e.target.value })}
            min={0}
            max={LIMITS.TAX_RATE_MAX}
            step="0.001"
          />
          <NumberField
            label="IGST rate (%)"
            disabled={untaxed}
            value={value.igstRate}
            onChange={(e) => setValue({ ...value, igstRate: e.target.value })}
            min={0}
            max={LIMITS.TAX_RATE_MAX}
            step="0.001"
          />
          <NumberField
            label="Cess rate (%)"
            value={value.cessRate}
            onChange={(e) => setValue({ ...value, cessRate: e.target.value })}
            min={0}
            max={LIMITS.TAX_RATE_MAX}
            step="0.001"
          />

          <SwitchField
            label="Prices include tax"
            helperText="Inclusive means the menu price already contains the GST shown above."
            checked={value.priceIsInclusive}
            onCheckedChange={(checked) => setValue({ ...value, priceIsInclusive: checked })}
          />

          <SelectField
            label="ITC eligibility"
            value={value.itcEligibility}
            onChange={(v) => setValue({ ...value, itcEligibility: v as ItcEligibility })}
            options={enumOptions(ItcEligibility)}
          />

          <TextField
            label="Effective from"
            type="date"
            value={value.effectiveFrom}
            onChange={(e) => setValue({ ...value, effectiveFrom: e.target.value })}
          />
          <TextField
            label="Effective to"
            helperText="Leave empty while the profile is open-ended."
            type="date"
            value={value.effectiveTo}
            onChange={(e) => setValue({ ...value, effectiveTo: e.target.value })}
          />

          {untaxed && (
            <TextField
              label="Tax exemption reason"
              value={value.exemptionReason}
              onChange={(e) => setValue({ ...value, exemptionReason: e.target.value })}
              maxLength={LIMITS.TAX_EXEMPTION_REASON_MAX}
            />
          )}

          <TextField
            label="Regulatory notes"
            multiline
            rows={2}
            value={value.regulatoryNotes}
            onChange={(e) => setValue({ ...value, regulatoryNotes: e.target.value })}
            maxLength={LIMITS.TAX_REGULATORY_NOTES_MAX}
          />

          {editing && (
            <SelectField
              label="Status"
              helperText="Deactivate rather than delete a profile that food items still use."
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
