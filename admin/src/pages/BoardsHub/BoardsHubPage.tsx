import { ModulePage } from '@/components/ModulePage';
import { ActivityTypesPage } from '../ActivityTypes/ActivityTypesPage';
import { BoardsPage } from '../Boards/BoardsPage';
import { StationsPage } from '../Stations/StationsPage';

export function BoardsHubPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="boards-hub"
      eyebrow="Boards"
      title="Stations, Boards & Activity Types"
      subtitle="Manage the sites, coordination boards and the activities that run on them."
      defaultTab="stations"
      tabs={[
        { key: 'stations', label: 'Stations', content: <StationsPage /> },
        { key: 'boards', label: 'Boards', content: <BoardsPage /> },
        { key: 'activities', label: 'Activity Type', content: <ActivityTypesPage /> },
      ]}
    />
  );
}

