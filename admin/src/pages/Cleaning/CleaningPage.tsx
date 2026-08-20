import { ModulePage } from '@/components/ModulePage';
import { CleaningOverviewPage } from './CleaningOverviewPage';
import { CleaningTasksPage } from './CleaningTasksPage';
import { CleaningReportsPage } from './CleaningReportsPage';
import { CleanableAssetsPage } from './CleanableAssetsPage';
import { CleaningRulesPage } from './CleaningRulesPage';
import { CleaningProceduresPage } from './CleaningProceduresPage';
import { CleaningWorkforcePage } from './CleaningWorkforcePage';
import { CleaningMastersPage } from './CleaningMastersPage';
import { CleaningCompliancePage } from './CleaningCompliancePage';

/**
 * Cleaning & Hygiene Management, as one Canteen OS application.
 *
 * The tab order is the order somebody actually uses them: what is happening now, the work, what
 * people reported, then the configuration behind it, and the record at the end. Every tab is a
 * page in its own right — nothing here is a wrapper that only exists to be nested.
 */
export function CleaningPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="cleaning"
      eyebrow="Facilities"
      title="Cleaning"
      subtitle="Cleaning schedules, checklists, area assignments and the hygiene record."
      defaultTab="overview"
      tabs={[
        { key: 'overview', label: 'Overview', content: <CleaningOverviewPage /> },
        { key: 'tasks', label: 'Tasks', content: <CleaningTasksPage /> },
        { key: 'reports', label: 'Reports', content: <CleaningReportsPage /> },
        { key: 'assets', label: 'Assets', content: <CleanableAssetsPage /> },
        { key: 'rules', label: 'Checklists', content: <CleaningRulesPage /> },
        { key: 'procedures', label: 'Procedures', content: <CleaningProceduresPage /> },
        { key: 'workforce', label: 'Workforce', content: <CleaningWorkforcePage /> },
        { key: 'masters', label: 'Masters', content: <CleaningMastersPage /> },
        { key: 'compliance', label: 'Hygiene record', content: <CleaningCompliancePage /> },
      ]}
    />
  );
}
