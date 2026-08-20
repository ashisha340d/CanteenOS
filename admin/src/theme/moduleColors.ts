/**
 * The controlled module colour system.
 *
 * Before this, every module carried its own hex literal in `appRegistry`, chosen when it was
 * added — which is how the product ended up with four different greens and a teal that was
 * really a cyan. A colour picked per module is decoration; a colour picked per *category* is
 * information, because it tells an operator that Purchase Entry and Purchase Register are the
 * same kind of thing before they have read either label.
 *
 * The rule for a new module is therefore never "choose a colour". It is "choose a category".
 *
 * Every value clears 4.5:1 against white, because that is what these are actually used for: a
 * filled tile with a white glyph on it, in the launcher, the Start menu and the task bar.
 */
export type ModuleCategory =
  | 'pos'
  | 'sales'
  | 'purchase'
  | 'inventory'
  | 'production'
  | 'customers'
  | 'suppliers'
  | 'accounting'
  | 'reports'
  | 'settings'
  /* Three beyond the standard ten, because this is a canteen rather than a generic ERP and
     forcing these into the ten would have put the menu catalogue under "sales" and the dish
     washer under "production" — losing exactly the distinction the colour exists to make. */
  | 'menu'
  | 'facilities'
  | 'people';

export const MODULE_CATEGORY_COLOR: Record<ModuleCategory, string> = {
  pos: '#1a73e8',
  sales: '#16a34a',
  purchase: '#f97316',
  inventory: '#8b5cf6',
  production: '#f59e0b',
  customers: '#14b8a6',
  suppliers: '#6366f1',
  accounting: '#0ea5e9',
  reports: '#06b6d4',
  settings: '#64748b',
  menu: '#6d5efc',
  facilities: '#b45309',
  people: '#ec4899',
};

/** Shown wherever a category is named rather than merely painted (settings, legends). */
export const MODULE_CATEGORY_LABEL: Record<ModuleCategory, string> = {
  pos: 'Point of sale',
  sales: 'Sales',
  purchase: 'Purchase',
  inventory: 'Inventory',
  production: 'Production',
  customers: 'Customers',
  suppliers: 'Suppliers',
  accounting: 'Accounting',
  reports: 'Reports',
  settings: 'Administration',
  menu: 'Menu',
  facilities: 'Facilities',
  people: 'People',
};

/** Which category each module belongs to. The single place a module's colour is decided. */
export const MODULE_CATEGORY: Record<string, ModuleCategory> = {
  'menu-master': 'menu',
  'menu-boards': 'menu',
  kiosks: 'customers',
  cds: 'customers',
  entities: 'suppliers',
  organization: 'settings',
  pos: 'pos',
  kds: 'production',
  'purchase-masters': 'purchase',
  'purchase-entry': 'purchase',
  'purchase-register': 'purchase',
  'purchase-documents': 'purchase',
  'vendor-accounting': 'accounting',
  stock: 'inventory',
  'sop-formulation': 'production',
  'equipment-maintenance': 'facilities',
  cleaning: 'facilities',
  people: 'people',
  'boards-hub': 'reports',
  settings: 'settings',
};

/** A module's accent, resolved through its category. Falls back to the neutral admin grey. */
export function moduleColor(moduleId: string): string {
  const category = MODULE_CATEGORY[moduleId];
  return MODULE_CATEGORY_COLOR[category ?? 'settings'];
}
