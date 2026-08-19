import { ModulePage } from '@/components/ModulePage';
import { ItemGroupsPage } from '../ItemGroups/ItemGroupsPage';
import { MenuCategoriesPage } from '../MenuCategories/MenuCategoriesPage';
import { MenuItemsPage } from '../MenuItems/MenuItemsPage';
import { MenusPage } from '../Menus/MenusPage';
import { ModifierAssignmentsPage } from '../ModifierAssignments/ModifierAssignmentsPage';
import { ModifierGroupsPage } from '../Modifiers/ModifierGroupsPage';

export function MenuMasterPage(): JSX.Element {
  return (
    <ModulePage
      moduleId="menu-master"
      eyebrow="Menu"
      title="Menu Master File"
      subtitle="Everything that defines what appears on the menu and how it can be customised."
      defaultTab="master-file"
      tabs={[
        // The items themselves come first — the rest of these tabs exist to organise them.
        { key: 'master-file', label: 'Menu Master File', content: <MenuItemsPage /> },
        { key: 'categories', label: 'Categories', content: <MenuCategoriesPage /> },
        { key: 'groups', label: 'Groups', content: <ItemGroupsPage /> },
        { key: 'catalogue', label: 'Menu Catalogue', content: <MenusPage /> },
        { key: 'modifiers', label: 'Modifiers', content: <ModifierGroupsPage /> },
        { key: 'assignment', label: 'Modifiers Assignment', content: <ModifierAssignmentsPage /> },
      ]}
    />
  );
}
