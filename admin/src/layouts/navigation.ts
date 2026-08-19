import {
  BellRingIcon,
  Building2Icon,
  ChartNoAxesCombinedIcon,
  ChefHatIcon,
  ContactIcon,
  HardHatIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  MonitorPlayIcon,
  MonitorSmartphoneIcon,
  ReceiptTextIcon,
  ScanBarcodeIcon,
  SparklesIcon,
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
  keywords?: string;
}

export interface NavSection {
  heading?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    heading: 'Menu & Service',
    items: [
      {
        to: '/menu-master',
        label: 'Menus',
        icon: UtensilsIcon,
        capability: Capability.MASTER_READ,
        keywords: 'menu master categories groups catalogue modifiers assignment',
      },
      {
        to: '/menu-boards',
        label: 'Digital Menu Boards',
        icon: MonitorIcon,
        capability: Capability.MASTER_READ,
        keywords: 'display screen wall board tv counter signage digital menu',
      },
      {
        to: '/kiosks',
        label: 'Kiosk',
        icon: MonitorSmartphoneIcon,
        capability: Capability.SETTINGS_READ,
        keywords: 'self service stand tablet skin theme printer upi',
      },
    ],
  },
  {
    heading: 'Organization',
    items: [
      {
        to: '/organization',
        label: 'Organization',
        icon: Building2Icon,
        capability: Capability.SETTINGS_READ,
        keywords: 'org name legal gstin tax profile compliance organisation',
      },
    ],
  },
  {
    heading: 'Operations',
    items: [
      {
        to: '/pos',
        label: 'POS',
        icon: ScanBarcodeIcon,
        capability: Capability.POS_READ,
        keywords: 'point of sale till counter sale bill checkout',
      },
      {
        to: '/kds',
        label: 'KDS',
        icon: MonitorIcon,
        capability: Capability.POS_READ,
        keywords: 'kitchen display system tickets screen',
      },
      {
        to: '/cds',
        label: 'CDS',
        icon: MonitorPlayIcon,
        capability: Capability.POS_READ,
        keywords: 'customer display system screen',
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
    heading: 'SOP',
    items: [
      {
        to: '/sop-formulation',
        label: 'SOP',
        icon: ChefHatIcon,
        capability: Capability.RECIPE_READ,
        keywords: 'ingredient categories ingredients recipe downloader recipes sop',
      },
    ],
  },
  {
    heading: 'Equipment & Facilities',
    items: [
      {
        to: '/equipment-maintenance',
        label: 'Equipment & Maintenance',
        icon: HardHatIcon,
        capability: Capability.EQUIPMENT_VIEW,
        keywords: 'asset machine oven mixer freezer monitoring dashboard breakdown',
      },
      {
        to: '/cleaning',
        label: 'Cleaning',
        icon: SparklesIcon,
        capability: Capability.MAINTENANCE_VIEW,
        keywords: 'cleaning schedules checklists area assignments',
      },
    ],
  },
  {
    heading: 'People',
    items: [
      {
        to: '/people',
        label: 'People',
        icon: UsersIcon,
        capability: Capability.USER_READ,
        keywords: 'users staff sign in tasks permissions roles capabilities access',
      },
    ],
  },
  {
    heading: 'Boards Messaging',
    items: [
      {
        to: '/boards-hub',
        label: 'Board Hub',
        icon: LayoutDashboardIcon,
        capability: Capability.MASTER_READ,
        keywords: 'stations boards activity types hub messaging',
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
        to: '/alerts',
        label: 'Alerts',
        icon: BellRingIcon,
        capability: Capability.ALERT_CONFIG,
        keywords: 'alarm sound buzzer new order reminder critical notification',
      },
    ],
  },
];

const EXTRA_TITLES: Record<string, string> = {
  '/change-password': 'Change password',
  '/account/security': 'Security',
  '/recipes/new': 'New recipe',
  '/recipes/:id/edit': 'Edit recipe',
  '/pos/entry': 'Sale',
  '/profile': 'Organization',
};

const NAV_TITLES: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) => section.items.map((item) => [item.to, item.label])),
);

const SECTION_OF: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((section) =>
    section.heading ? section.items.map((item) => [item.to, section.heading as string]) : [],
  ),
);

export interface Crumb {
  label: string;
  to?: string;
}

export function crumbsFor(pathname: string): Crumb[] {
  if (pathname === '/') return [{ label: 'Dashboard' }];

  const segments = pathname.split('/').filter(Boolean);
  const rootPath = `/${segments[0] ?? ''}`;
  const rootLabel = NAV_TITLES[rootPath] ?? EXTRA_TITLES[rootPath] ?? titleCase(segments[0] ?? '');

  const crumbs: Crumb[] = [];
  const section = SECTION_OF[rootPath];
  if (section) crumbs.push({ label: section });

  if (segments.length > 1) {
    crumbs.push({ label: rootLabel, to: rootPath });
    const leaf = segments[segments.length - 1] ?? '';
    crumbs.push({ label: titleCase(leaf) });
  } else {
    crumbs.push({ label: rootLabel });
  }

  return crumbs;
}

export function titleFor(pathname: string): string {
  const crumbs = crumbsFor(pathname);
  return crumbs[crumbs.length - 1]?.label ?? 'Canteen OS';
}

function titleCase(segment: string): string {
  const words = segment.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
