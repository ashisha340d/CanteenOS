import {
  EquipmentStatus,
  MaintenancePriority,
  MaintenanceTicketStatus,
  WarrantyStatus,
} from '@menuboard/shared';
import type { StatusToneName } from '@/lib/tones';

/**
 * Status -> tone for this module.
 *
 * `StatusChip` maps the shared statuses the rest of the portal uses, but equipment and
 * maintenance add twenty-odd of their own. They collapse onto the same six tones rather than
 * introducing new colours: a reader learns "red means stopped" once.
 */

export const EQUIPMENT_STATUS_TONE: Readonly<Record<EquipmentStatus, StatusToneName>> = {
  [EquipmentStatus.OPERATIONAL]: 'success',
  [EquipmentStatus.RUNNING]: 'success',
  [EquipmentStatus.IDLE]: 'neutral',
  [EquipmentStatus.NEEDS_ATTENTION]: 'progress',
  [EquipmentStatus.PROBLEM]: 'danger',
  [EquipmentStatus.UNDER_MAINTENANCE]: 'info',
  [EquipmentStatus.OUT_OF_SERVICE]: 'danger',
  [EquipmentStatus.RETIRED]: 'muted',
};

export const TICKET_STATUS_TONE: Readonly<Record<MaintenanceTicketStatus, StatusToneName>> = {
  [MaintenanceTicketStatus.REPORTED]: 'danger',
  [MaintenanceTicketStatus.ACKNOWLEDGED]: 'progress',
  [MaintenanceTicketStatus.ASSIGNED]: 'progress',
  [MaintenanceTicketStatus.SUPPLIER_CONTACTED]: 'info',
  [MaintenanceTicketStatus.TECHNICIAN_SCHEDULED]: 'info',
  [MaintenanceTicketStatus.UNDER_MAINTENANCE]: 'info',
  [MaintenanceTicketStatus.WAITING_FOR_PARTS]: 'progress',
  [MaintenanceTicketStatus.RESOLVED]: 'success',
  [MaintenanceTicketStatus.VERIFIED]: 'success',
  [MaintenanceTicketStatus.CLOSED]: 'muted',
  [MaintenanceTicketStatus.CANCELLED]: 'muted',
};

export const PRIORITY_TONE: Readonly<Record<MaintenancePriority, StatusToneName>> = {
  [MaintenancePriority.LOW]: 'muted',
  [MaintenancePriority.NORMAL]: 'neutral',
  [MaintenancePriority.HIGH]: 'progress',
  [MaintenancePriority.CRITICAL]: 'danger',
};

export const WARRANTY_TONE: Readonly<Record<WarrantyStatus, StatusToneName>> = {
  [WarrantyStatus.UNKNOWN]: 'muted',
  [WarrantyStatus.ACTIVE]: 'success',
  [WarrantyStatus.EXPIRING_SOON]: 'progress',
  [WarrantyStatus.EXPIRED]: 'danger',
};

/** 'YYYY-MM-DD' or an ISO instant as a short, local, unambiguous date. */
export function formatDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "in 12 days" / "6 days overdue" — the form a person actually reads a due date in. */
export function dueLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'Not scheduled';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}
