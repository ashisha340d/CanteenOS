import { lazy, type ComponentType } from 'react';
import type { WindowIcon } from './WindowManager';
import { moduleIcons } from '../theme/fluentIcons';
import { moduleColor } from '../theme/moduleColors';

/* Each module is its own chunk, fetched the first time its window is opened — neither the
   desktop nor the Start menu may drag every page in the product into its bundle. */
const MenuMasterPage = lazy(() => import('../pages/MenuMaster/MenuMasterPage').then((m) => ({ default: m.MenuMasterPage })));
const MenuBoardsPage = lazy(() => import('../pages/MenuBoards/MenuBoardsPage').then((m) => ({ default: m.MenuBoardsPage })));
const KiosksPage = lazy(() => import('../pages/Kiosks/KiosksPage').then((m) => ({ default: m.KiosksPage })));
const OrganizationPage = lazy(() => import('../pages/Organization/OrganizationPage').then((m) => ({ default: m.OrganizationPage })));
const PosDashboardPage = lazy(() => import('../pages/Pos/PosDashboardPage').then((m) => ({ default: m.PosDashboardPage })));
const KDSPage = lazy(() => import('../pages/KDS/KDSPage').then((m) => ({ default: m.KDSPage })));
const CDSPage = lazy(() => import('../pages/CDS/CDSPage').then((m) => ({ default: m.CDSPage })));
const EntitiesPage = lazy(() => import('../pages/Entities/EntitiesPage').then((m) => ({ default: m.EntitiesPage })));
const SopFormulationPage = lazy(() => import('../pages/SopFormulation/SopFormulationPage').then((m) => ({ default: m.SopFormulationPage })));
const PurchaseMastersPage = lazy(() => import('../pages/Purchase/PurchaseMastersPage').then((m) => ({ default: m.PurchaseMastersPage })));
const PurchaseMargEntryPage = lazy(() => import('../pages/Purchase/PurchaseMargEntryPage').then((m) => ({ default: m.PurchaseMargEntryPage })));
const PurchaseRegisterPage = lazy(() => import('../pages/Purchase/PurchaseRegisterPage').then((m) => ({ default: m.PurchaseRegisterPage })));
const VendorAccountingPage = lazy(() => import('../pages/Purchase/VendorAccountingPage').then((m) => ({ default: m.VendorAccountingPage })));
const PurchaseDocumentsPage = lazy(() => import('../pages/Purchase/PurchaseDocumentsPage').then((m) => ({ default: m.PurchaseDocumentsPage })));
const StockPage = lazy(() => import('../pages/Stock/StockPage').then((m) => ({ default: m.StockPage })));
const EquipmentMaintenancePage = lazy(() => import('../pages/EquipmentMaintenance/EquipmentMaintenancePage').then((m) => ({ default: m.EquipmentMaintenancePage })));
const CleaningPage = lazy(() => import('../pages/Cleaning/CleaningPage').then((m) => ({ default: m.CleaningPage })));
const PeoplePage = lazy(() => import('../pages/People/PeoplePage').then((m) => ({ default: m.PeoplePage })));
const BoardsHubPage = lazy(() => import('../pages/BoardsHub/BoardsHubPage').then((m) => ({ default: m.BoardsHubPage })));
const DesktopSettingsPage = lazy(() => import('../pages/Settings/DesktopSettingsPage').then((m) => ({ default: m.DesktopSettingsPage })));

/** Start-menu grouping. Desktop icon order follows the array, not the group. */
export type AppGroup =
  | 'Operations'
  | 'Menu'
  | 'Kitchen'
  | 'Facilities'
  | 'People'
  | 'Administration';

export const APP_GROUPS: AppGroup[] = [
  'Operations',
  'Menu',
  'Kitchen',
  'Facilities',
  'People',
  'Administration',
];

export interface DesktopApp {
  id: string;
  label: string;
  accent: string;
  group: AppGroup;
  Icon: WindowIcon;
  Component: ComponentType;
  /**
   * Full-screen appliances (POS, display screens): open maximized, never restore to floating,
   * never close on Escape. The counter is not a place for window management.
   */
  alwaysMaximized?: boolean;
  /**
   * A separate application, not a page of this one: the icon opens it in its own browser window.
   *
   * The KDS and CDS are their own app on their own port with their own sign-in and station
   * choice, because they run on screens that are not this workstation. Embedding them in a
   * window here would ask the wall display's questions of the office desk.
   */
  externalUrl?: string;
}

/** Where the display app lives. Same host as the admin portal, its own dev/preview port. */
const DISPLAY_APP_URL = `${window.location.protocol}//${window.location.hostname}:5185`;

/**
 * Every entry point in Canteen OS. The single source of truth for the desktop icons, the Start
 * menu and the window that each one opens — a module added here appears in all three.
 *
 * Note what a definition does *not* carry: an icon, or a colour. Both used to be written out
 * per module, which is how the product accumulated four greens and how a module could end up
 * drawn with whatever glyph its author happened to import. They are now derived below, from the
 * registries — so adding a module is choosing a category and a Fluent glyph in one place each,
 * and a colour that disagrees with its category is not expressible.
 */
interface AppDefinition {
  id: string;
  label: string;
  group: AppGroup;
  Component: ComponentType;
  alwaysMaximized?: boolean;
  externalUrl?: string;
}

const APP_DEFINITIONS: AppDefinition[] = [
  { id: 'menu-master', label: 'Menus', group: 'Menu', Component: MenuMasterPage },
  { id: 'menu-boards', label: 'Digital Menu Boards', group: 'Menu', Component: MenuBoardsPage },
  { id: 'kiosks', label: 'Kiosk', group: 'Menu', Component: KiosksPage },
  { id: 'organization', label: 'Organization', group: 'Administration', Component: OrganizationPage },
  { id: 'pos', label: 'POS', group: 'Operations', Component: PosDashboardPage, alwaysMaximized: true },
  { id: 'kds', label: 'KDS', group: 'Operations', Component: KDSPage, externalUrl: DISPLAY_APP_URL },
  { id: 'cds', label: 'CDS', group: 'Operations', Component: CDSPage, externalUrl: `${DISPLAY_APP_URL}/?mode=cds` },
  { id: 'entities', label: 'Entities', group: 'Operations', Component: EntitiesPage },
  { id: 'purchase-masters', label: 'Purchase Masters', group: 'Operations', Component: PurchaseMastersPage },
  { id: 'purchase-entry', label: 'Purchase Entry', group: 'Operations', Component: PurchaseMargEntryPage, alwaysMaximized: true },
  { id: 'purchase-register', label: 'Purchase Register', group: 'Operations', Component: PurchaseRegisterPage },
  { id: 'vendor-accounting', label: 'Vendor Accounting', group: 'Operations', Component: VendorAccountingPage },
  { id: 'purchase-documents', label: 'Purchase Documents', group: 'Operations', Component: PurchaseDocumentsPage },
  { id: 'stock', label: 'Stock & Inventory', group: 'Operations', Component: StockPage },
  { id: 'sop-formulation', label: 'SOP', group: 'Kitchen', Component: SopFormulationPage },
  { id: 'equipment-maintenance', label: 'Equipment & Maintenance', group: 'Facilities', Component: EquipmentMaintenancePage },
  { id: 'cleaning', label: 'Cleaning', group: 'Facilities', Component: CleaningPage },
  { id: 'people', label: 'People', group: 'People', Component: PeoplePage },
  { id: 'boards-hub', label: 'Board Hub', group: 'People', Component: BoardsHubPage },
  { id: 'settings', label: 'Settings', group: 'Administration', Component: DesktopSettingsPage },
];

/** The neutral cog, used for a module whose id is missing from the icon registry. */
const FALLBACK_ICON: WindowIcon = moduleIcons.settings?.regular ?? (() => null);

export const APPS: DesktopApp[] = APP_DEFINITIONS.map((definition) => ({
  ...definition,
  Icon: moduleIcons[definition.id]?.regular ?? FALLBACK_ICON,
  accent: moduleColor(definition.id),
}));

export const SETTINGS_APP_ID = 'settings';

export function findApp(id: string): DesktopApp | undefined {
  return APPS.find((app) => app.id === id);
}
