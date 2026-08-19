import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EquipmentCategoryWriteRequest,
  EquipmentCreateRequest,
  EquipmentDocumentType,
  EquipmentListQuery,
  EquipmentMoveRequest,
  EquipmentStatusChangeRequest,
  EquipmentSupplierRole,
  EquipmentSupplierWriteRequest,
  EquipmentUpdateRequest,
  FloorPlanPositionWriteRequest,
  MaintenanceAssignRequest,
  MaintenanceCompleteRequest,
  MaintenanceScheduleWriteRequest,
  MaintenanceStatusChangeRequest,
  MaintenanceTicketCreateRequest,
  MaintenanceTicketListQuery,
  MaintenanceTicketUpdateRequest,
  MasterStatus,
  SupplierContactWriteRequest,
} from '@menuboard/shared';
import {
  equipmentApi,
  maintenanceApi,
  supplierApi,
  type MasterQuery,
  type ScheduleListQuery,
  type SupplierListQuery,
} from '../api/equipment';

/**
 * Query keys are coarse on purpose. Almost every write in this module changes something a
 * neighbouring screen shows — closing a ticket changes the asset's counters, its status, the
 * dashboard and the timeline — so mutations invalidate the whole module rather than trying to
 * predict the blast radius and getting it wrong.
 */
const MODULE_KEYS = ['equipment', 'maintenance', 'equipment-suppliers', 'floor-plans'] as const;

function useModuleMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of MODULE_KEYS) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

/* ------------------------------------------------------------------- masters */

export function useEquipmentFloors(query: MasterQuery = {}) {
  return useQuery({
    queryKey: ['equipment', 'floors', query],
    queryFn: () => equipmentApi.listFloors(query),
  });
}

export function useEquipmentAreas(query: MasterQuery = {}) {
  return useQuery({
    queryKey: ['equipment', 'areas', query],
    queryFn: () => equipmentApi.listAreas(query),
  });
}

export function useEquipmentLocations(query: MasterQuery = {}) {
  return useQuery({
    queryKey: ['equipment', 'locations', query],
    queryFn: () => equipmentApi.listLocations(query),
  });
}

export function useLocationTree(query: MasterQuery = {}) {
  return useQuery({
    queryKey: ['equipment', 'location-tree', query],
    queryFn: () => equipmentApi.locationTree(query),
  });
}

export function useEquipmentCategories(query: MasterQuery = {}) {
  return useQuery({
    queryKey: ['equipment', 'categories', query],
    queryFn: () => equipmentApi.listCategories(query),
  });
}

export function useCreateFloor() {
  return useModuleMutation((body: { code: string; name: string; levelIndex?: number }) =>
    equipmentApi.createFloor(body),
  );
}

export function useUpdateFloor() {
  return useModuleMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: { code?: string; name?: string; levelIndex?: number; status?: MasterStatus };
    }) => equipmentApi.updateFloor(id, body),
  );
}

export function useCreateArea() {
  return useModuleMutation(
    (body: {
      floorId: string;
      code: string;
      name: string;
      assetSegment: string;
      sortOrder?: number;
    }) => equipmentApi.createArea(body),
  );
}

export function useUpdateArea() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      equipmentApi.updateArea(id, body),
  );
}

export function useCreateLocation() {
  return useModuleMutation(
    (body: {
      areaId: string;
      name: string;
      room?: string | null;
      section?: string | null;
      position?: string | null;
    }) => equipmentApi.createLocation(body),
  );
}

export function useUpdateLocation() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      equipmentApi.updateLocation(id, body),
  );
}

export function useCreateCategory() {
  return useModuleMutation((body: EquipmentCategoryWriteRequest) =>
    equipmentApi.createCategory(body),
  );
}

export function useUpdateCategory() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: Partial<EquipmentCategoryWriteRequest> }) =>
      equipmentApi.updateCategory(id, body),
  );
}

export function useDeleteCategory() {
  return useModuleMutation((id: string) => equipmentApi.removeCategory(id));
}

/* ----------------------------------------------------------------- equipment */

export function useEquipmentDashboard() {
  return useQuery({
    queryKey: ['equipment', 'dashboard'],
    queryFn: () => equipmentApi.dashboard(),
    // The dashboard is a wall display as often as it is a page.
    refetchInterval: 60_000,
  });
}

export function useEquipmentList(query: EquipmentListQuery) {
  return useQuery({
    queryKey: ['equipment', 'list', query],
    queryFn: () => equipmentApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useEquipment(id: string | undefined) {
  return useQuery({
    queryKey: ['equipment', 'detail', id],
    queryFn: () => equipmentApi.get(id as string),
    enabled: id !== undefined,
  });
}

export function useEquipmentActivity(id: string | undefined) {
  return useQuery({
    queryKey: ['equipment', 'activity', id],
    queryFn: () => equipmentApi.activity(id as string),
    enabled: id !== undefined,
  });
}

export function useEquipmentStatusHistory(id: string | undefined) {
  return useQuery({
    queryKey: ['equipment', 'status-history', id],
    queryFn: () => equipmentApi.statusHistory(id as string),
    enabled: id !== undefined,
  });
}

export function useCreateEquipment() {
  return useModuleMutation((body: EquipmentCreateRequest) => equipmentApi.create(body));
}

export function useUpdateEquipment() {
  return useModuleMutation(({ id, body }: { id: string; body: EquipmentUpdateRequest }) =>
    equipmentApi.update(id, body),
  );
}

export function useDeleteEquipment() {
  return useModuleMutation((id: string) => equipmentApi.remove(id));
}

export function useChangeEquipmentStatus() {
  return useModuleMutation(({ id, body }: { id: string; body: EquipmentStatusChangeRequest }) =>
    equipmentApi.changeStatus(id, body),
  );
}

export function useMoveEquipment() {
  return useModuleMutation(({ id, body }: { id: string; body: EquipmentMoveRequest }) =>
    equipmentApi.move(id, body),
  );
}

export function useAddEquipmentDocument() {
  return useModuleMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: { mediaId: string; docType?: EquipmentDocumentType; title?: string | null; applyWarranty?: boolean };
    }) => equipmentApi.addDocument(id, body),
  );
}

export function useDeleteEquipmentDocument() {
  return useModuleMutation((documentId: string) => equipmentApi.removeDocument(documentId));
}

export function useAddWarranty() {
  return useModuleMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: {
        provider?: string | null;
        policyNumber?: string | null;
        startDate?: string | null;
        expiryDate?: string | null;
        months?: number | null;
        terms?: string | null;
      };
    }) => equipmentApi.addWarranty(id, body),
  );
}

export function useSetEquipmentSupplier() {
  return useModuleMutation(
    ({
      id,
      body,
    }: {
      id: string;
      body: { supplierId: string; role: EquipmentSupplierRole; isDefault?: boolean };
    }) => equipmentApi.setSupplierLink(id, body),
  );
}

export function useRemoveEquipmentSupplier() {
  return useModuleMutation(({ id, role }: { id: string; role: EquipmentSupplierRole }) =>
    equipmentApi.removeSupplierLink(id, role),
  );
}

export function useUploadEquipmentMedia() {
  return useMutation({
    mutationFn: ({ file, title }: { file: File; title?: string }) =>
      equipmentApi.uploadMedia(file, title),
  });
}

/* ------------------------------------------------------------------------ AI */

export function useIdentifyEquipment() {
  return useMutation({ mutationFn: (mediaId: string) => equipmentApi.identify(mediaId) });
}

export function useScanDocument() {
  return useMutation({
    mutationFn: ({ mediaId, docType }: { mediaId: string; docType: EquipmentDocumentType }) =>
      equipmentApi.scanDocument(mediaId, docType),
  });
}

/* ---------------------------------------------------------------- floor plans */

export function useFloorPlanView(floorId: string | undefined) {
  return useQuery({
    queryKey: ['floor-plans', 'view', floorId],
    queryFn: () => equipmentApi.floorPlanView(floorId as string),
    enabled: floorId !== undefined,
  });
}

export function useCreateFloorPlan() {
  return useModuleMutation(
    (body: { floorId: string; name: string; mediaId: string; width?: number | null; height?: number | null }) =>
      equipmentApi.createFloorPlan(body),
  );
}

export function useDeleteFloorPlan() {
  return useModuleMutation((id: string) => equipmentApi.removeFloorPlan(id));
}

export function useSetFloorPlanPosition() {
  return useModuleMutation(({ id, body }: { id: string; body: FloorPlanPositionWriteRequest }) =>
    equipmentApi.setFloorPlanPosition(id, body),
  );
}

export function useRemoveFloorPlanPosition() {
  return useModuleMutation(({ id, equipmentId }: { id: string; equipmentId: string }) =>
    equipmentApi.removeFloorPlanPosition(id, equipmentId),
  );
}

/* --------------------------------------------------------------- maintenance */

export function useMaintenanceTickets(query: MaintenanceTicketListQuery) {
  return useQuery({
    queryKey: ['maintenance', 'tickets', query],
    queryFn: () => maintenanceApi.listTickets(query),
    placeholderData: (previous) => previous,
  });
}

export function useMaintenanceTicket(id: string | undefined) {
  return useQuery({
    queryKey: ['maintenance', 'ticket', id],
    queryFn: () => maintenanceApi.getTicket(id as string),
    enabled: id !== undefined,
  });
}

export function useCreateTicket() {
  return useModuleMutation((body: MaintenanceTicketCreateRequest) =>
    maintenanceApi.createTicket(body),
  );
}

export function useUpdateTicket() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: MaintenanceTicketUpdateRequest }) =>
      maintenanceApi.updateTicket(id, body),
  );
}

export function useChangeTicketStatus() {
  return useModuleMutation(({ id, body }: { id: string; body: MaintenanceStatusChangeRequest }) =>
    maintenanceApi.changeStatus(id, body),
  );
}

export function useAssignTicket() {
  return useModuleMutation(({ id, body }: { id: string; body: MaintenanceAssignRequest }) =>
    maintenanceApi.assign(id, body),
  );
}

export function useCompleteTicket() {
  return useModuleMutation(({ id, body }: { id: string; body: MaintenanceCompleteRequest }) =>
    maintenanceApi.complete(id, body),
  );
}

export function useAddTicketNote() {
  return useModuleMutation(({ id, note }: { id: string; note: string }) =>
    maintenanceApi.addNote(id, note),
  );
}

export function useDeleteTicket() {
  return useModuleMutation((id: string) => maintenanceApi.removeTicket(id));
}

export function useMaintenanceSchedules(query: ScheduleListQuery) {
  return useQuery({
    queryKey: ['maintenance', 'schedules', query],
    queryFn: () => maintenanceApi.listSchedules(query),
    placeholderData: (previous) => previous,
  });
}

export function useCreateSchedule() {
  return useModuleMutation((body: MaintenanceScheduleWriteRequest) =>
    maintenanceApi.createSchedule(body),
  );
}

export function useUpdateSchedule() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: Partial<MaintenanceScheduleWriteRequest> }) =>
      maintenanceApi.updateSchedule(id, body),
  );
}

export function useDeleteSchedule() {
  return useModuleMutation((id: string) => maintenanceApi.removeSchedule(id));
}

export function useRunMaintenanceSweep() {
  return useModuleMutation((_trigger: void) => maintenanceApi.runSweep());
}

/* ----------------------------------------------------------------- suppliers */

export function useSuppliers(query: SupplierListQuery) {
  return useQuery({
    queryKey: ['equipment-suppliers', 'list', query],
    queryFn: () => supplierApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useSupplier(id: string | undefined) {
  return useQuery({
    queryKey: ['equipment-suppliers', 'detail', id],
    queryFn: () => supplierApi.get(id as string),
    enabled: id !== undefined,
  });
}

export function useCreateSupplier() {
  return useModuleMutation((body: EquipmentSupplierWriteRequest) => supplierApi.create(body));
}

export function useUpdateSupplier() {
  return useModuleMutation(
    ({ id, body }: { id: string; body: Partial<EquipmentSupplierWriteRequest> }) =>
      supplierApi.update(id, body),
  );
}

export function useDeleteSupplier() {
  return useModuleMutation((id: string) => supplierApi.remove(id));
}

export function useAddSupplierContact() {
  return useModuleMutation(({ id, body }: { id: string; body: SupplierContactWriteRequest }) =>
    supplierApi.addContact(id, body),
  );
}

export function useDeleteSupplierContact() {
  return useModuleMutation((contactId: string) => supplierApi.removeContact(contactId));
}

/** The server composes the message; the portal only opens the link it hands back. */
export function useWhatsappDraft() {
  return useMutation({
    mutationFn: (body: { equipmentId: string; ticketId?: string | null; supplierId?: string | null }) =>
      supplierApi.whatsappDraft(body),
  });
}

export function useLogWhatsapp() {
  return useModuleMutation(
    (body: { equipmentId: string; ticketId?: string | null; supplierId?: string | null; message?: string | null }) =>
      supplierApi.logWhatsapp(body),
  );
}

export function useLogCall() {
  return useModuleMutation(
    (body: {
      equipmentId: string;
      ticketId?: string | null;
      supplierId?: string | null;
      contactId?: string | null;
      phoneNumber: string;
    }) => supplierApi.logCall(body),
  );
}
