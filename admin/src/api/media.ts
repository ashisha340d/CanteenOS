import type {
  MediaAssetDto,
  MediaAssetUpdateRequest,
  MediaAssignmentDto,
  MediaAssignmentWriteRequest,
  MediaEntityType,
  PageQuery,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface MediaListQuery extends PageQuery {
  unassignedOnly?: boolean;
}

export const mediaApi = {
  list: (query: MediaListQuery) =>
    unwrapPaged<MediaAssetDto>(http.get('/media', { params: query })),
  upload: (file: File, params?: { title?: string; altText?: string }) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<MediaAssetDto>(http.post('/media/upload', form, { params }));
  },
  update: (id: string, body: Partial<MediaAssetUpdateRequest>) =>
    unwrap<MediaAssetDto>(http.put(`/media/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/media/${id}`)),
};

export const mediaAssignmentsApi = {
  listForEntity: (entityType: MediaEntityType, entityId: string) =>
    unwrap<MediaAssignmentDto[]>(
      http.get('/media/assignments/for-entity', { params: { entityType, entityId } }),
    ),
  assign: (body: MediaAssignmentWriteRequest) =>
    unwrap<MediaAssignmentDto>(http.post('/media/assignments', body)),
  unassign: (id: string) => unwrap<null>(http.delete(`/media/assignments/${id}`)),
  setPrimary: (id: string) =>
    unwrap<MediaAssignmentDto>(http.post(`/media/assignments/${id}/set-primary`)),
  reorder: (id: string, sortOrder: number) =>
    unwrap<null>(http.post(`/media/assignments/${id}/reorder`, { sortOrder })),
};
