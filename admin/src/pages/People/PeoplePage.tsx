import { ModulePage } from '@/components/ModulePage';
import { UsersPage } from '../Users/UsersPage';
import { TasksPage } from '../Tasks/TasksPage';
import { PermissionsPage } from '../Permissions/PermissionsPage';

export function PeoplePage(): JSX.Element {
  return (
    <ModulePage
      moduleId="people"
      eyebrow="People"
      title="People"
      subtitle="Users, tasks and access permissions."
      defaultTab="users"
      tabs={[
        { key: 'users', label: 'Users', content: <UsersPage /> },
        { key: 'tasks', label: 'Tasks', content: <TasksPage /> },
        { key: 'permissions', label: 'Permissions', content: <PermissionsPage /> },
      ]}
    />
  );
}

