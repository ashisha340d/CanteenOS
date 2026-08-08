import type { ActivityTypeDto, MenuCategoryDto, MenuItemDto, Paginated, StationDto } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

/**
 * Read-only master data client. There is deliberately no write method here — Android never
 * originates a station/activity-type/menu-category/menu-item write (docs/SCOPE.md).
 */
export const mastersApi = {
  async listStations(): Promise<Paginated<StationDto> | StationDto[]> {
    const response = await apiClient.get('/stations', { params: { pageSize: 200 } });
    return unwrap(response);
  },
  async listActivityTypes(): Promise<Paginated<ActivityTypeDto> | ActivityTypeDto[]> {
    const response = await apiClient.get('/activity-types', { params: { pageSize: 200 } });
    return unwrap(response);
  },
  async listMenuCategories(): Promise<Paginated<MenuCategoryDto> | MenuCategoryDto[]> {
    const response = await apiClient.get('/menu-categories', { params: { pageSize: 200 } });
    return unwrap(response);
  },
  async listMenuItems(): Promise<Paginated<MenuItemDto> | MenuItemDto[]> {
    const response = await apiClient.get('/menu-items', { params: { pageSize: 500 } });
    return unwrap(response);
  },
};
