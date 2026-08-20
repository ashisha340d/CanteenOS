import { lazy, type ComponentType } from 'react';
import {
  Building2Icon,
  ChefHatIcon,
  ClipboardListIcon,
  ContactIcon,
  FileTextIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  MonitorPlayIcon,
  MonitorSmartphoneIcon,
  PackageIcon,
  ReceiptTextIcon,
  ScanBarcodeIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
  UtensilsIcon,
  WalletIcon,
  WarehouseIcon,
  WrenchIcon,
} from 'lucide-react';
import type { WindowIcon } from './WindowManager';

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
 */
export const APPS: DesktopApp[] = [
  { id: 'menu-master', label: 'Menus', accent: '#5b4ff5', group: 'Menu', Icon: UtensilsIcon, Component: MenuMasterPage },
  { id: 'menu-boards', label: 'Digital Menu Boards', accent: '#2570da', group: 'Menu', Icon: MonitorIcon, Component: MenuBoardsPage },
  { id: 'kiosks', label: 'Kiosk', accent: '#0e9f6e', group: 'Menu', Icon: MonitorSmartphoneIcon, Component: KiosksPage },
  { id: 'organization', label: 'Organization', accent: '#d08511', group: 'Administration', Icon: Building2Icon, Component: OrganizationPage },
  { id: 'pos', label: 'POS', accent: '#dc3545', group: 'Operations', Icon: ScanBarcodeIcon, Component: PosDashboardPage, alwaysMaximized: true },
  { id: 'kds', label: 'KDS', accent: '#7c3aed', group: 'Operations', Icon: ChefHatIcon, Component: KDSPage, externalUrl: DISPLAY_APP_URL },
  { id: 'cds', label: 'CDS', accent: '#0891b2', group: 'Operations', Icon: MonitorPlayIcon, Component: CDSPage, externalUrl: `${DISPLAY_APP_URL}/?mode=cds` },
  { id: 'entities', label: 'Entities', accent: '#6366f1', group: 'Operations', Icon: ContactIcon, Component: EntitiesPage },
  { id: 'purchase-masters', label: 'Purchase Masters', accent: '#0f766e', group: 'Operations', Icon: PackageIcon, Component: PurchaseMastersPage },
  { id: 'purchase-entry', label: 'Purchase Entry', accent: '#0f766e', group: 'Operations', Icon: ReceiptTextIcon, Component: PurchaseMargEntryPage, alwaysMaximized: true },
  { id: 'purchase-register', label: 'Purchase Register', accent: '#0f766e', group: 'Operations', Icon: HistoryIcon, Component: PurchaseRegisterPage },
  { id: 'vendor-accounting', label: 'Vendor Accounting', accent: '#0f766e', group: 'Operations', Icon: WalletIcon, Component: VendorAccountingPage },
  { id: 'purchase-documents', label: 'Purchase Documents', accent: '#0f766e', group: 'Operations', Icon: FileTextIcon, Component: PurchaseDocumentsPage },
  { id: 'stock', label: 'Stock & Inventory', accent: '#0891b2', group: 'Operations', Icon: WarehouseIcon, Component: StockPage },
  { id: 'sop-formulation', label: 'SOP', accent: '#0a7048', group: 'Kitchen', Icon: ClipboardListIcon, Component: SopFormulationPage },
  { id: 'equipment-maintenance', label: 'Equipment & Maintenance', accent: '#b45309', group: 'Facilities', Icon: WrenchIcon, Component: EquipmentMaintenancePage },
  { id: 'cleaning', label: 'Cleaning', accent: '#16a34a', group: 'Facilities', Icon: SparklesIcon, Component: CleaningPage },
  { id: 'people', label: 'People', accent: '#db2777', group: 'People', Icon: UsersIcon, Component: PeoplePage },
  { id: 'boards-hub', label: 'Board Hub', accent: '#e11d48', group: 'People', Icon: LayoutDashboardIcon, Component: BoardsHubPage },
  { id: 'settings', label: 'Settings', accent: '#52606d', group: 'Administration', Icon: SettingsIcon, Component: DesktopSettingsPage },
];

export const SETTINGS_APP_ID = 'settings';

export function findApp(id: string): DesktopApp | undefined {
  return APPS.find((app) => app.id === id);
}
