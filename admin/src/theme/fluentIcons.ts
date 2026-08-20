/**
 * The icon registries — every Fluent glyph the product uses, named once.
 *
 * The rule this file exists to enforce: **Edit is one icon everywhere.** Before it, a form that
 * wanted a delete button imported whatever its author reached for, so the same verb was drawn
 * three ways on three screens and an operator had to re-learn the toolbar per module. Looking a
 * verb up in a registry makes that impossible by construction — there is one entry for `delete`,
 * so there is one delete icon.
 *
 * Three registries, because they answer three different questions:
 *   - `moduleIcons`  — what *is* this? (a place in the product)
 *   - `actionIcons`  — what will this *do*? (a verb)
 *   - `statusIcons`  — how did it *go*? (a state)
 *
 * Fluent ships each glyph in Regular and Filled. The convention here is Regular for anything
 * that sits in a toolbar or a row, Filled for the launcher tiles and for status — a filled
 * glyph reads as a solid object at 26px and as a signal at 16px, and an outline reads better as
 * a control. Where both are wanted the registry holds the pair.
 */
import {
  AddRegular,
  ArrowDownloadRegular,
  ArrowSortRegular,
  ArrowSyncRegular,
  ArrowUploadRegular,
  BookOpenFilled,
  BookOpenRegular,
  BowlChopsticksFilled,
  BowlChopsticksRegular,
  BoxFilled,
  BoxMultipleFilled,
  BoxMultipleRegular,
  BoxRegular,
  BuildingFilled,
  BuildingRegular,
  CalculatorFilled,
  CalculatorRegular,
  CartFilled,
  CartRegular,
  CheckmarkCircleFilled,
  CheckmarkCircleRegular,
  ClipboardBulletListLtrRegular,
  ClipboardTaskListLtrFilled,
  ClipboardTaskListLtrRegular,
  DataBarVerticalFilled,
  DataBarVerticalRegular,
  DataPieRegular,
  DeleteRegular,
  DesktopFilled,
  DesktopRegular,
  DismissCircleRegular,
  DismissRegular,
  DocumentBulletListFilled,
  DocumentBulletListRegular,
  EditRegular,
  ErrorCircleFilled,
  ErrorCircleRegular,
  FilterRegular,
  FoodFilled,
  FoodRegular,
  HistoryFilled,
  HistoryRegular,
  HomeRegular,
  InfoFilled,
  InfoRegular,
  LocationRegular,
  PaymentRegular,
  PeopleFilled,
  PeopleRegular,
  PeopleTeamFilled,
  PeopleTeamRegular,
  PrintRegular,
  ProductionRegular,
  ReceiptFilled,
  ReceiptMoneyRegular,
  ReceiptRegular,
  SaveRegular,
  ScreenPersonFilled,
  ScreenPersonRegular,
  SearchRegular,
  SettingsFilled,
  SettingsRegular,
  ShieldRegular,
  SparkleFilled,
  SparkleRegular,
  TabletFilled,
  TabletRegular,
  VehicleTruckRegular,
  WarningFilled,
  WarningRegular,
  WrenchFilled,
  WrenchRegular,
} from '@fluentui/react-icons';
import type { ComponentType } from 'react';

/**
 * The shape every consumer needs and the only one this codebase relies on. Fluent's own
 * `FluentIcon` type carries more, but narrowing here keeps `WindowManager.WindowIcon`,
 * `DesktopApp.Icon` and these registries structurally interchangeable — which is what lets a
 * module icon be dropped into the window caption and the task bar without a wrapper.
 */
export type AppIcon = ComponentType<{ className?: string }>;

/** A glyph in both of Fluent's weights, for the places that want to switch between them. */
export interface IconPair {
  regular: AppIcon;
  filled: AppIcon;
}

/* ------------------------------------------------------------------------- modules */

/**
 * Keyed by `DesktopApp.id`. Each is the most semantically accurate Fluent glyph available —
 * a truck for the vendors, a bowl for the kitchen display, a clipboard for the SOPs — never
 * one shape recoloured, which is the failure mode this registry replaced.
 */
export const moduleIcons: Record<string, IconPair> = {
  'menu-master': { regular: FoodRegular, filled: FoodFilled },
  'menu-boards': { regular: DesktopRegular, filled: DesktopFilled },
  kiosks: { regular: TabletRegular, filled: TabletFilled },
  cds: { regular: ScreenPersonRegular, filled: ScreenPersonFilled },
  organization: { regular: BuildingRegular, filled: BuildingFilled },
  pos: { regular: ReceiptRegular, filled: ReceiptFilled },
  kds: { regular: BowlChopsticksRegular, filled: BowlChopsticksFilled },
  entities: { regular: PeopleTeamRegular, filled: PeopleTeamFilled },
  'purchase-masters': { regular: BoxRegular, filled: BoxFilled },
  'purchase-entry': { regular: CartRegular, filled: CartFilled },
  'purchase-register': { regular: BookOpenRegular, filled: BookOpenFilled },
  'purchase-documents': { regular: DocumentBulletListRegular, filled: DocumentBulletListFilled },
  'vendor-accounting': { regular: CalculatorRegular, filled: CalculatorFilled },
  stock: { regular: BoxMultipleRegular, filled: BoxMultipleFilled },
  'sop-formulation': { regular: ClipboardTaskListLtrRegular, filled: ClipboardTaskListLtrFilled },
  'equipment-maintenance': { regular: WrenchRegular, filled: WrenchFilled },
  cleaning: { regular: SparkleRegular, filled: SparkleFilled },
  people: { regular: PeopleRegular, filled: PeopleFilled },
  'boards-hub': { regular: DataBarVerticalRegular, filled: DataBarVerticalFilled },
  settings: { regular: SettingsRegular, filled: SettingsFilled },
};

/**
 * Concepts the product names but that are not themselves launchable modules — a report header,
 * a ledger tab, a GST section. Kept beside the module icons so a screen about stock movement
 * uses the same glyph whether it is a window or a tab inside one.
 */
export const conceptIcons: Record<string, AppIcon> = {
  dashboard: HomeRegular,
  sales: ReceiptMoneyRegular,
  payments: PaymentRegular,
  gst: ReceiptRegular,
  reports: DataPieRegular,
  'stock-ledger': HistoryRegular,
  recipe: ClipboardBulletListLtrRegular,
  production: ProductionRegular,
  suppliers: VehicleTruckRegular,
  locations: LocationRegular,
  security: ShieldRegular,
  counter: BuildingRegular,
};

/* ------------------------------------------------------------------------- actions */

export type ActionName =
  | 'add'
  | 'edit'
  | 'delete'
  | 'save'
  | 'cancel'
  | 'refresh'
  | 'print'
  | 'export'
  | 'import'
  | 'filter'
  | 'sort'
  | 'search'
  | 'approve'
  | 'reject';

/** One glyph per verb, product-wide. Adding a synonym here is a bug, not a feature. */
export const actionIcons: Record<ActionName, AppIcon> = {
  add: AddRegular,
  edit: EditRegular,
  delete: DeleteRegular,
  save: SaveRegular,
  cancel: DismissRegular,
  refresh: ArrowSyncRegular,
  print: PrintRegular,
  export: ArrowDownloadRegular,
  import: ArrowUploadRegular,
  filter: FilterRegular,
  sort: ArrowSortRegular,
  search: SearchRegular,
  approve: CheckmarkCircleRegular,
  reject: DismissCircleRegular,
};

/* -------------------------------------------------------------------------- status */

export type StatusName = 'success' | 'warning' | 'error' | 'info' | 'pending';

/**
 * Status is the one place the *filled* weight is the default: a state is a signal, and at 16px
 * in a table row an outline reads as a control the operator could press.
 */
export const statusIcons: Record<StatusName, IconPair> = {
  success: { regular: CheckmarkCircleRegular, filled: CheckmarkCircleFilled },
  warning: { regular: WarningRegular, filled: WarningFilled },
  error: { regular: ErrorCircleRegular, filled: ErrorCircleFilled },
  info: { regular: InfoRegular, filled: InfoFilled },
  pending: { regular: HistoryRegular, filled: HistoryFilled },
};

/** The colour each status is painted in, as a theme token rather than a literal. */
export const STATUS_TONE: Record<StatusName, string> = {
  success: 'var(--tone-success, #107c41)',
  warning: 'var(--tone-warning, #a16207)',
  error: 'var(--destructive, #c4314b)',
  info: 'var(--tone-info, #0f6cbd)',
  pending: 'var(--muted-foreground)',
};
