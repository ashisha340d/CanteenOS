import { MasterStatus } from '@menuboard/shared';
import { SelectField } from '@/components/form/fields';
import { useTaxProfiles } from '../../hooks/useTax';

const INHERIT = '__inherit__';

/**
 * A variant's tax treatment. The default — and the overwhelmingly common case — is to inherit
 * the food item's profile, so "Inherited" is a real, selectable, sticky choice rather than an
 * empty value: `taxProfileId = null` on the variant means inherit, and choosing a profile here
 * is the explicit override the specification allows.
 */
export function VariantTaxOverride({
  variantTaxProfileId,
  itemTaxProfileId,
  onChange,
}: {
  variantTaxProfileId: string | null;
  itemTaxProfileId: string | null;
  onChange: (taxProfileId: string | null) => void;
}): JSX.Element {
  const { data } = useTaxProfiles({ status: MasterStatus.ACTIVE, page: 1, pageSize: 200 });
  const profiles = data?.items ?? [];
  const inherited = profiles.find((p) => p.id === itemTaxProfileId);

  return (
    <SelectField
      label="Tax Profile"
      helperText={
        variantTaxProfileId === null
          ? `Inherited${inherited ? `: ${inherited.name}` : ''}`
          : 'Overrides the food item'
      }
      value={variantTaxProfileId ?? INHERIT}
      onChange={(v) => onChange(v === INHERIT ? null : v)}
      options={[
        {
          value: INHERIT,
          label: inherited ? `Inherit — ${inherited.name}` : 'Inherit from item',
        },
        ...profiles.map((p) => ({ value: p.id, label: p.name })),
      ]}
      className="w-52"
    />
  );
}
