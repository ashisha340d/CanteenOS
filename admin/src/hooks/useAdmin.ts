import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BillingStatus,
  BoardRole,
  Capability,
  CreateKioskDeviceRequest,
  GenerateBillingRequest,
  ReportKind,
  ReportQuery,
  UpdateKioskDeviceRequest,
  UserRole,
} from '@menuboard/shared';
import {
  auditApi,
  billingApi,
  dashboardApi,
  kioskDevicesApi,
  permissionsApi,
  reportsApi,
  settingsApi,
  type AuditListQuery,
  type BillingListQuery,
} from '../api/admin';

export function useDashboard() {
  return useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.get, refetchInterval: 60_000 });
}

export function usePermissionsMatrix() {
  return useQuery({ queryKey: ['permissions'], queryFn: permissionsApi.get });
}

export function useSetRoleCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      role,
      capability,
      granted,
    }: {
      role: UserRole;
      capability: Capability;
      granted: boolean;
    }) => permissionsApi.setRoleCapability(role, capability, granted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permissions'] }),
  });
}

export function useSetBoardRoleCapability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      boardRole,
      capability,
      granted,
    }: {
      boardRole: BoardRole;
      capability: Capability;
      granted: boolean;
    }) => permissionsApi.setBoardRoleCapability(boardRole, capability, granted),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['permissions'] }),
  });
}

export function useReport<T>(kind: ReportKind | null, query: ReportQuery, enabled: boolean) {
  return useQuery({
    queryKey: ['report', kind, query],
    queryFn: () => reportsApi.run<T>(kind as ReportKind, query),
    enabled: enabled && kind !== null,
    placeholderData: (p) => p,
  });
}

export function useBillingList(query: BillingListQuery) {
  return useQuery({ queryKey: ['billing', query], queryFn: () => billingApi.list(query), placeholderData: (p) => p });
}

export function useBillingSnapshot(id: string | undefined) {
  return useQuery({
    queryKey: ['billing-snapshot', id],
    queryFn: () => billingApi.getSnapshot(id as string),
    enabled: Boolean(id),
  });
}

export function useGenerateBilling() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateBillingRequest) => billingApi.generate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }),
  });
}

export function useUpdateBillingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: BillingStatus }) => billingApi.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing'] }),
  });
}

export function useAuditList(query: AuditListQuery) {
  return useQuery({ queryKey: ['audit', query], queryFn: () => auditApi.list(query), placeholderData: (p) => p });
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: settingsApi.list });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => settingsApi.update(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

/* ------------------------------------------------------------------ kiosk devices */

export function useKioskDevices() {
  // Polled: `lastSeenAt` is the only signal the portal has that a stand in a hall two floors
  // away is actually switched on, and a stale one is read as a dead kiosk.
  return useQuery({
    queryKey: ['kiosk-devices'],
    queryFn: kioskDevicesApi.list,
    refetchInterval: 60_000,
  });
}

export function useCreateKioskDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateKioskDeviceRequest) => kioskDevicesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kiosk-devices'] }),
  });
}

export function useUpdateKioskDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateKioskDeviceRequest }) =>
      kioskDevicesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kiosk-devices'] }),
  });
}

export function useDeleteKioskDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => kioskDevicesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kiosk-devices'] }),
  });
}
