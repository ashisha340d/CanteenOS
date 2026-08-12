import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'tax-profiles', to: '/tax-profiles', label: 'Tax Profiles' },
  { key: 'hsn-sac', to: '/hsn-sac', label: 'HSN/SAC Master' },
] as const;

/**
 * The two Tax & Compliance masters share one header so the relationship between them is
 * visible: classification reference data on one side, the reusable tax treatment that cites
 * it on the other. They are separate routes rather than local tab state so each is
 * linkable and each can carry its own capability gate.
 */
export function TaxComplianceTabs({
  active,
  actions,
}: {
  active: (typeof TABS)[number]['key'];
  actions?: ReactNode;
}): JSX.Element {
  return (
    <>
      <PageHeader
        eyebrow="Tax & Compliance"
        title={TABS.find((tab) => tab.key === active)?.label ?? 'Tax & Compliance'}
        subtitle={
          active === 'hsn-sac'
            ? 'Official GST/GSTN classification reference data. Imported by synchronization, never hand-authored.'
            : 'Reusable tax treatment. Rates live here, not on the classification master, and a synchronization never changes them.'
        }
        actions={actions}
      />
      <nav className="border-border mb-6 flex gap-1 border-b" aria-label="Tax and compliance masters">
        {TABS.map((tab) => (
          <NavLink
            key={tab.key}
            to={tab.to}
            {...(tab.key === active ? { 'aria-current': 'page' as const } : {})}
            className={cn(
              'focus-ring relative -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab.key === active
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
