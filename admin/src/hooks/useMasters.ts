import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ActivityTypeWriteRequest,
  CreateStationRequest,
  MenuCategoryWriteRequest,
  MenuItemWriteRequest,
  UpdateStationRequest,
} from '@menuboard/shared';
import {
  activityTypesApi,
  menuCategoriesApi,
  menuItemsApi,
  stationsApi,
  type MasterListQuery,
} from '../api/masters';

/* ------------------------------------------------------------------- stations */

export function useStations(query: MasterListQuery) {
  return useQuery({
    queryKey: ['stations', query],
    queryFn: () => stationsApi.list(query),
    placeholderData: (p) => p,
  });
}
export function useStation(id: string | undefined) {
  return useQuery({
    queryKey: ['station', id],
    queryFn: () => stationsApi.get(id as string),
    enabled: Boolean(id),
  });
}
export function useCreateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStationRequest) => stationsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}
export function useUpdateStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStationRequest }) =>
      stationsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}
export function useDeleteStation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stationsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
  });
}

/* -------------------------------------------------------------- activity types */

export function useActivityTypes(query: MasterListQuery) {
  return useQuery({ queryKey: ['activity-types', query], queryFn: () => activityTypesApi.list(query), placeholderData: (p) => p });
}
export function useCreateActivityType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: ActivityTypeWriteRequest) => activityTypesApi.create(body), onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }) });
}
export function useUpdateActivityType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ActivityTypeWriteRequest> }) => activityTypesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }),
  });
}
export function useDeleteActivityType() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => activityTypesApi.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['activity-types'] }) });
}

/* -------------------------------------------------------------- menu categories */

export function useMenuCategories(query: MasterListQuery) {
  return useQuery({ queryKey: ['menu-categories', query], queryFn: () => menuCategoriesApi.list(query), placeholderData: (p) => p });
}
export function useCreateMenuCategory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: MenuCategoryWriteRequest) => menuCategoriesApi.create(body), onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-categories'] }) });
}
export function useUpdateMenuCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuCategoryWriteRequest> }) => menuCategoriesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-categories'] }),
  });
}
export function useDeleteMenuCategory() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => menuCategoriesApi.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-categories'] }) });
}

/* ------------------------------------------------------------------- menu items */

export function useMenuItems(query: MasterListQuery & { categoryId?: string }) {
  return useQuery({ queryKey: ['menu-items', query], queryFn: () => menuItemsApi.list(query), placeholderData: (p) => p });
}
export function useCreateMenuItem() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: MenuItemWriteRequest) => menuItemsApi.create(body), onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-items'] }) });
}
export function useUpdateMenuItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MenuItemWriteRequest> }) => menuItemsApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-items'] }),
  });
}
export function useDeleteMenuItem() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => menuItemsApi.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-items'] }) });
}
