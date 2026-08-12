import type {
  ActivityTypeDto,
  ActivityTypeWriteRequest,
  CreateStationRequest,
  MasterStatus,
  MenuCategoryDto,
  MenuCategoryWriteRequest,
  MenuItemDto,
  MenuItemWriteRequest,
  PageQuery,
  StationDto,
  UpdateStationRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface MasterListQuery extends PageQuery {
  status?: MasterStatus;
}

export const stationsApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<StationDto>(http.get('/stations', { params: query })),
  get: (id: string) => unwrap<StationDto>(http.get(`/stations/${id}`)),
  create: (body: CreateStationRequest) => unwrap<StationDto>(http.post('/stations', body)),
  update: (id: string, body: UpdateStationRequest) =>
    unwrap<StationDto>(http.patch(`/stations/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/stations/${id}`)),
};

export const activityTypesApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<ActivityTypeDto>(http.get('/activity-types', { params: query })),
  create: (body: ActivityTypeWriteRequest) =>
    unwrap<ActivityTypeDto>(http.post('/activity-types', body)),
  update: (id: string, body: Partial<ActivityTypeWriteRequest>) =>
    unwrap<ActivityTypeDto>(http.patch(`/activity-types/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/activity-types/${id}`)),
};

export const menuCategoriesApi = {
  list: (query: MasterListQuery) =>
    unwrapPaged<MenuCategoryDto>(http.get('/menu-categories', { params: query })),
  create: (body: MenuCategoryWriteRequest) =>
    unwrap<MenuCategoryDto>(http.post('/menu-categories', body)),
  update: (id: string, body: Partial<MenuCategoryWriteRequest>) =>
    unwrap<MenuCategoryDto>(http.patch(`/menu-categories/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menu-categories/${id}`)),
};

export const menuItemsApi = {
  list: (query: MasterListQuery & { categoryId?: string }) =>
    unwrapPaged<MenuItemDto>(http.get('/menu-items', { params: query })),
  get: (id: string) => unwrap<MenuItemDto>(http.get(`/menu-items/${id}`)),
  create: (body: MenuItemWriteRequest) => unwrap<MenuItemDto>(http.post('/menu-items', body)),
  update: (id: string, body: Partial<MenuItemWriteRequest>) =>
    unwrap<MenuItemDto>(http.patch(`/menu-items/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/menu-items/${id}`)),
};
