import {
  BellRingIcon,
  BookOpenIcon,
  CarrotIcon,
  ChartNoAxesCombinedIcon,
  ChefHatIcon,
  ContactIcon,
  HistoryIcon,
  LayersIcon,
  LayoutDashboardIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MapPinIcon,
  PercentIcon,
  PrinterIcon,
  ReceiptTextIcon,
  ScrollTextIcon,
  Settings2Icon,
  ShieldIcon,
  ScanBarcodeIcon,
  SlidersHorizontalIcon,
  StoreIcon,
  TagsIcon,
  TicketIcon,
  MonitorPlayIcon,
  UsersIcon,
  UtensilsIcon,
  type LucideIcon,
} from 'lucide-react';
import { Capability } from '@menuboard/shared';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  capability?: Capability;
  /** Shown in the mobile bottom bar. At most four ever fit. */
  primary?: boolean;
  /** Extra words the command palette should match on. */
  keywords?: string;
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading. */
  heading?: string;
  items: NavItem[];
}

/**
 * Grouped by what the operator is doing, not by which table the data lives in. A flat list of
 * eleven links makes every destination equally hard to find.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      {
        to: '/',
        label: 'Overview',
        icon: LayoutGridIcon,
        capability: Capability.REPORT_READ,
        primary: true,
        keywords: 'dashboard home summary',
      },
      {
        to: '/stations',
        label: 'Stations',
        icon: MapPinIcon,
        capability: Capability.MASTER_READ,
        primary: true,
        keywords: 'barsana mangarh site campus',
      },
      {
        to: '/boards',
        label: 'Boards',
        icon: LayoutDashboardIcon,
        capability: Capability.BOARD_READ_ALL,
        primary: true,
        keywords: 'teams coordination',
      },
      {
        to: '/activity-types',
        label: 'Activity Types',
        icon: TicketIcon,
        capability: Capability.MASTER_READ,
        keywords: 'breakfast lunch dinner festival event',
      },
    ],
  },
  {
    heading: 'Menu',
    items: [
      {
        to: '/menu-categories',
        label: 'Menu Categories',
        icon: TagsIcon,
        capability: Capability.MASTER_READ,
        keywords: 'categories food dishes',
      },
      {
        to: '/item-groups',
        label: 'Menu Groups',
        icon: LayersIcon,
        capability: Capability.MASTER_READ,
        keywords: 'a la carte combo set menu tags item groups',
      },
      {
        to: '/menus',
        label: 'Menu Catalogue',
        icon: BookOpenIcon,
        capability: Capability.MASTER_READ,
        keywords: 'vsk public satsangee menu master variants pricing catalogues',
      },
      {
        to: '/modifiers',
        label: 'Menu Modifiers',
        icon: SlidersHorizontalIcon,
        capability: Capability.MASTER_READ,
        keywords: 'extra cheese no onion toppings size upgrade',
      },
      {
        to: '/menu-items',
        label: 'Menu Master File',
        icon: UtensilsIcon,
        capability: Capability.MASTER_READ,
        keywords: 'items food dishes master file',
      },
      {
        to: '/counters',
        label: 'Service Counters',
        icon: StoreIcon,
        capability: Capability.MASTER_READ,
        keywords: 'service routing pickup',
      },
      {
        to: '/printing-groups',
        label: 'Kitchen Groups',
        icon: PrinterIcon,
        capability: Capability.MASTER_READ,
        keywords: 'kitchen bakery coffee bar ticket routing',
      },
    ],
  },
  {
    heading: 'Counter',
    items: [
      {
        to: '/pos',
        label: 'Point of Sale',
        icon: ScanBarcodeIcon,
        capability: Capability.POS_READ,
        primary: true,
        keywords: 'pos till counter sale bill checkout draft scheduled takeaway named order',
      },
      {
        to: '/entities',
        label: 'Entities',
        icon: ContactIcon,
        capability: Capability.ENTITY_READ,
        keywords: 'customer employee vendor supplier party contact account ledger',
      },
    ],
  },
  {
    heading: 'Tax & Compliance',
    items: [
      {
        to: '/tax-profiles',
        label: 'Tax Profiles',
        icon: PercentIcon,
        capability: Capability.TAX_READ,
        keywords: 'gst cgst sgst igst cess rate tax treatment restaurant service inclusive',
      },
      {
        to: '/hsn-sac',
        label: 'HSN/SAC Master',
        icon: ScrollTextIcon,
        capability: Capability.TAX_READ,
        keywords: 'gst gstn classification hsn sac code sync goods services chapter heading',
      },
    ],
  },
  {
    heading: 'Catalogue/Collection',
    items: [
      {
        to: '/ingredient-categories',
        label: 'Ingredients Categories',
        icon: TagsIcon,
        capability: Capability.RECIPE_READ,
        keywords: 'group ingredients',
      },
      {
        to: '/ingredients',
        label: 'Ingredients',
        icon: CarrotIcon,
        capability: Capability.RECIPE_READ,
        keywords: 'recipe master unit',
      },
      {
        to: '/youtube-imports',
        label: 'Youtube Recipe Downloader',
        icon: MonitorPlayIcon,
        capability: Capability.RECIPE_WRITE,
        keywords: 'video import extract recipe download youtube',
      },
      {
        to: '/recipes',
        label: 'Recipes',
        icon: ChefHatIcon,
        capability: Capability.RECIPE_READ,
        keywords: 'method steps variants cooking',
      },
    ],
  },
  {
    heading: 'People',
    items: [
      {
        to: '/users',
        label: 'Users',
        icon: UsersIcon,
        capability: Capability.USER_READ,
        primary: true,
        keywords: 'accounts staff sign in',
      },
      {
        to: '/tasks',
        label: 'Tasks',
        icon: ListChecksIcon,
        capability: Capability.TASK_READ,
        keywords: 'assign work volunteer duty job self assigned off time activity',
      },
      {
        to: '/permissions',
        label: 'Permissions',
        icon: ShieldIcon,
        capability: Capability.PERMISSION_READ,
        keywords: 'roles capabilities access',
      },
    ],
  },
  {
    heading: 'Records',
    items: [
      {
        to: '/reports',
        label: 'Reports',
        icon: ChartNoAxesCombinedIcon,
        capability: Capability.REPORT_READ,
        keywords: 'analytics figures',
      },
      {
        to: '/billing',
        label: 'Billing',
        icon: ReceiptTextIcon,
        capability: Capability.BILLING_READ,
        keywords: 'invoices snapshots charges',
      },
      {
        to: '/audit',
        label: 'Audit log',
        icon: HistoryIcon,
        capability: Capability.AUDIT_READ,
        keywords: 'history changes trail',
      },
      {
        to: '/settings',
        label: 'Settings',
        icon: Settings2Icon,
        capability: Capability.SETTINGS_READ,
        keywords: 'configuration preferences',
      },
      {
        to: '/alerts',
        label: 'Alerts',
        icon: BellRingIcon,
        capability: Capability.ALERT_CONFIG,
        keywords: 'alarm sound buzzer new order reminder critical notification',
      },
    ],
  },
];

/**
 * Titles for routes that are not themselves nav destinations, so breadcrumbs and the mobile
 * header can still name where you are.
 */
const EXTRA_TITLES: Record<string, string> = {
  '/change-password': 'Change password',
  '/account/security': 'Security',
  '/recipes/new': 'New recipe',
  '/recipes/:id/edit': 'Edit recipe',
  '/pos/entry': 'Sale',
};

const NAV_TITLES: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.to, item.label])),
);

/** The section a route belongs to, for the middle breadcrumb. */
const SECTION_OF: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) =>
    section.heading ? section.items.map((item) => [item.to, section.heading as string]) : [],
  ),
);

export interface Crumb {
  label: string;
  to?: string;
}

/**
 * Breadcrumbs derived from the path rather than declared per page, so a new route cannot
 * forget to provide them. Nested paths (`/boards/:id/members`) keep their parent link.
 */
export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Overview' }];

  const segments = pathname.split('/').filter(Boolean);
  const rootPath = `/${segments[0] ?? ''}`;
  const rootLabel = NAV_TITLES[rootPath] ?? EXTRA_TITLES[rootPath] ?? titleCase(segments[0] ?? '');

  const crumbs: Crumb[] = [];
  const section = SECTION_OF[rootPath];
  if (section) crumbs.push({ label: section });

  // A deeper path means the root becomes a link back rather than the current location.
  if (segments.length > 1) {
    crumbs.push({ label: rootLabel, to: rootPath });
    const leaf = segments[segments.length - 1] ?? '';
    crumbs.push({ label: titleCase(leaf) });
  } else {
    crumbs.push({ label: rootLabel });
  }

  return crumbs;
}

/** The page name on its own — used for the mobile header and the document title. */
export function titleFor(pathname: string): string {
  const crumbs = crumbsFor(pathname);
  return crumbs[crumbs.length - 1]?.label ?? 'Canteen OS';
}

function titleCase(segment: string): string {
  const words = segment.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
