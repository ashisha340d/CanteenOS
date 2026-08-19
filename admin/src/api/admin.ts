import type {
  AuditLogDto,
  BillingExportDto,
  BillingSnapshot,
  BillingStatus,
  BoardRole,
  Capability,
  CreateKioskDeviceRequest,
  DashboardSummary,
  GenerateBillingRequest,
  IsoDate,
  KioskDeviceDto,
  PageQuery,
  Paginated,
  ReportKind,
  ReportQuery,
  SettingDto,
  UpdateKioskDeviceRequest,
  UserRole,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export const dashboardApi = {
  get: () => unwrap<DashboardSummary>(http.get('/admin/dashboard')),
};

export interface PermissionsMatrix {
  roleCapabilities: Record<UserRole, Capability[]>;
  boardRoleCapabilities: Record<BoardRole, Capability[]>;
  androidForbiddenCapabilities: Capability[];
}

export const permissionsApi = {
  get: () => unwrap<PermissionsMatrix>(http.get('/admin/permissions')),
  setRoleCapability: (role: UserRole, capability: Capability, granted: boolean) =>
    unwrap<null>(http.patch(`/admin/permissions/role/${role}/${capability}`, { granted })),
  setBoardRoleCapability: (boardRole: BoardRole, capability: Capability, granted: boolean) =>
    unwrap<null>(
      http.patch(`/admin/permissions/board-role/${boardRole}/${capability}`, { granted }),
    ),
};

export interface ReportResult<T> {
  kind: ReportKind;
  rows: T[];
  /** Present only for COMPLETED_ORDERS, PENDING_ORDERS and BILLING_EXPORT_HISTORY. */
  page?: Paginated<T>;
}

export const reportsApi = {
  run: <T>(kind: ReportKind, query: ReportQuery) =>
    unwrap<ReportResult<T>>(http.get(`/admin/reports/${kind}`, { params: query })),
};

export interface BillingListQuery extends PageQuery {
  boardId?: string;
  status?: BillingStatus;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

export const billingApi = {
  list: (query: BillingListQuery) =>
    unwrapPaged<BillingExportDto>(http.get('/admin/billing', { params: query })),
  get: (id: string) => unwrap<BillingExportDto>(http.get(`/admin/billing/${id}`)),
  getSnapshot: (id: string) => unwrap<BillingSnapshot>(http.get(`/admin/billing/${id}/snapshot`)),
  generate: (body: GenerateBillingRequest) =>
    unwrap<BillingExportDto>(http.post('/admin/billing/generate', body)),
  updateStatus: (id: string, status: BillingStatus) =>
    unwrap<BillingExportDto>(http.post(`/admin/billing/${id}/status`, { status })),
};

export interface AuditListQuery extends PageQuery {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  boardId?: string;
  dateFrom?: IsoDate;
  dateTo?: IsoDate;
}

export const auditApi = {
  list: (query: AuditListQuery) => unwrapPaged<AuditLogDto>(http.get('/admin/audit', { params: query })),
  forEntity: (entityType: string, entityId: string) =>
    unwrap<AuditLogDto[]>(http.get(`/admin/audit/${entityType}/${entityId}`)),
};

export const settingsApi = {
  list: () => unwrap<SettingDto[]>(http.get('/admin/settings')),
  update: (key: string, value: unknown) => unwrap<SettingDto>(http.put(`/admin/settings/${key}`, { value })),
};

/**
 * The self-service stands. Provisioning a kiosk used to mean standing in front of it with a
 * password; it is now a row edited from here, and the tablet holds nothing but the code.
 */
export const kioskDevicesApi = {
  list: () => unwrap<KioskDeviceDto[]>(http.get('/admin/kiosk-devices')),
  create: (body: CreateKioskDeviceRequest) =>
    unwrap<KioskDeviceDto>(http.post('/admin/kiosk-devices', body)),
  update: (id: string, body: UpdateKioskDeviceRequest) =>
    unwrap<KioskDeviceDto>(http.patch(`/admin/kiosk-devices/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/admin/kiosk-devices/${id}`)),
};
