import { Link } from 'react-router-dom';
import { MasterStatus, type TaxProfileDto } from '@menuboard/shared';
import { ExternalLinkIcon, InfoIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FieldGroup, FieldRow, SelectField } from '@/components/form/fields';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTaxProfiles } from '../../hooks/useTax';

const percent = (value: number): string => `${Number(value).toFixed(2).replace(/\.00$/, '')}%`;

function ReadOnly({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-xs font-medium tracking-[0.04em] uppercase">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
    </div>
  );
}

/**
 * The Food Item's tax treatment: choose a Tax Profile, and everything else is shown as the
 * consequence of that choice rather than as separate editable fields.
 *
 * This screen deliberately has no synchronization controls and no rate inputs. Rates belong to
 * the Tax Profile master, so that changing a rate is one reviewed edit in one place instead of
 * a per-dish value that silently drifts. "Manage Profiles" leads there.
 */
export function TaxComplianceSection({
  taxProfileId,
  onChange,
}: {
  taxProfileId: string | null;
  onChange: (id: string | null) => void;
}): JSX.Element {
  const { data } = useTaxProfiles({ status: MasterStatus.ACTIVE, page: 1, pageSize: 200 });
  const profiles: TaxProfileDto[] = data?.items ?? [];
  const selected = profiles.find((p) => p.id === taxProfileId) ?? null;

  return (
    <section className="bg-card rounded-xl border p-4">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="font-heading text-base font-semibold">Tax &amp; Compliance</h2>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-muted-foreground">
              <InfoIcon className="size-4" />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            The tax profile carries the GST treatment and the HSN/SAC classification. Variants
            inherit it unless one is given an explicit override.
          </TooltipContent>
        </Tooltip>
        <Link
          to="/tax-profiles"
          className="text-primary ml-auto inline-flex items-center gap-1 text-sm hover:underline"
        >
          Manage Profiles
          <ExternalLinkIcon className="size-3.5" />
        </Link>
      </div>

      <FieldGroup>
        <SelectField
          label="Tax Profile"
          helperText={
            profiles.length === 0
              ? 'No active tax profiles yet. Create one under Tax & Compliance → Tax Profiles.'
              : 'Applies to this dish and, by inheritance, to every one of its variants.'
          }
          value={taxProfileId ?? ''}
          onChange={(v) => onChange(v === '' ? null : v)}
          emptyLabel="No tax profile"
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          className="sm:max-w-md"
        />

        {selected && (
          <>
            <FieldRow className="sm:grid-cols-3">
              <ReadOnly label="Supply Type" value={selected.supplyType} />
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs font-medium tracking-[0.04em] uppercase">
                  HSN / SAC Code
                </p>
                <p className="mt-0.5 flex items-center gap-2 text-sm font-medium">
                  {selected.hsnSacCode ? (
                    <>
                      <span className="font-mono">{selected.hsnSacCode}</span>
                      <Badge variant="outline" className="text-[0.625rem]">
                        {selected.hsnSacCodeType}
                      </Badge>
                    </>
                  ) : (
                    '—'
                  )}
                </p>
                {selected.hsnSacDescription && (
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {selected.hsnSacCodeType}: {selected.hsnSacDescription}
                  </p>
                )}
              </div>
              <ReadOnly label="GST Taxability" value={selected.gstTaxability} />
            </FieldRow>

            {/* Five rate columns inside a 640px breakpoint leaves ~120px each; step up to the
                full row only once there is width for it. */}
            <FieldRow className="grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
              <ReadOnly label="GST Rate" value={percent(selected.gstRate)} />
              <ReadOnly label="CGST Rate" value={percent(selected.cgstRate)} />
              <ReadOnly label="SGST Rate" value={percent(selected.sgstRate)} />
              <ReadOnly label="IGST Rate" value={percent(selected.igstRate)} />
              <ReadOnly label="Cess Rate" value={percent(selected.cessRate)} />
            </FieldRow>

            <FieldRow className="sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnly
                label="Tax Inclusive / Exclusive"
                value={selected.priceIsInclusive ? 'Inclusive' : 'Exclusive'}
              />
              <ReadOnly label="ITC Eligibility" value={selected.itcEligibility} />
              <ReadOnly label="Effective From" value={selected.effectiveFrom ?? '—'} />
              <ReadOnly label="Effective To" value={selected.effectiveTo ?? '—'} />
            </FieldRow>

            {(selected.exemptionReason || selected.regulatoryNotes) && (
              <FieldRow className="sm:grid-cols-2">
                <ReadOnly label="Tax Exemption Reason" value={selected.exemptionReason ?? '—'} />
                <ReadOnly label="Regulatory Notes" value={selected.regulatoryNotes ?? '—'} />
              </FieldRow>
            )}
          </>
        )}
      </FieldGroup>
    </section>
  );
}
