import { ModulePage } from '@/components/ModulePage';
import { PortalSettings } from '../Kiosks/PortalSettings';
import { TaxProfilesPage } from '../Tax/TaxProfilesPage';
import { HsnSacMasterPage } from '../Tax/HsnSacMasterPage';
import { KdsPanel } from './KdsPanel';
import { useSettings } from '../../hooks/useAdmin';

function OrganisationTab(): JSX.Element {
  const { data } = useSettings();
  return <PortalSettings settings={data ?? []} />;
}

export function OrganizationPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="organization"
      eyebrow="Organization"
      title="Organization"
      subtitle="Legal identity, tax profiles and GST compliance."
      defaultTab="profile"
      tabs={[
        { key: 'profile', label: 'Organization Profile', content: <OrganisationTab /> },
        { key: 'tax', label: 'Tax Profile', content: <TaxProfilesPage /> },
        { key: 'compliance', label: 'Tax Compliances', content: <HsnSacMasterPage /> },
        { key: 'kds', label: 'KDS & CDS', content: <KdsPanel /> },
      ]}
    />
  );
}

