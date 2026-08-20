import { ModulePage } from '@/components/ModulePage';
import { ItemGroupsPage } from '../ItemGroups/ItemGroupsPage';
import { MenuCategoriesPage } from '../MenuCategories/MenuCategoriesPage';
import { MenuItemsPage } from '../MenuItems/MenuItemsPage';
import { MenusPage } from '../Menus/MenusPage';
import { ModifierAssignmentsPage } from '../ModifierAssignments/ModifierAssignmentsPage';
import { ModifierGroupsPage } from '../Modifiers/ModifierGroupsPage';
import { MenuRouteAssignmentsPage } from './MenuRouteAssignmentsPage';

export function MenuMasterPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="menu-master"
      defaultTab="master-file"
      hideHeader
      tabs={[
        // The items themselves come first — the rest of these tabs exist to organise them.
        { key: 'master-file', label: 'Menu Master File', content: <MenuItemsPage /> },
        { key: 'categories', label: 'Categories', content: <MenuCategoriesPage /> },
        { key: 'groups', label: 'Groups', content: <ItemGroupsPage /> },
        { key: 'catalogue', label: 'Menu Catalogue', content: <MenusPage /> },
        { key: 'counter-assignment', label: 'Counter Assignment', content: <MenuRouteAssignmentsPage mode="counter" /> },
        { key: 'kitchen-assignment', label: 'Kitchen Assignment', content: <MenuRouteAssignmentsPage mode="kitchen" /> },
        { key: 'modifiers', label: 'Modifiers', content: <ModifierGroupsPage /> },
        { key: 'assignment', label: 'Modifier Assignment', content: <ModifierAssignmentsPage /> },
      ]}
    />
  );
}
