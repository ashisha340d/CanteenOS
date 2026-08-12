import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MediaAssetUpdateRequest,
  MediaAssignmentWriteRequest,
  MediaEntityType,
} from '@menuboard/shared';
import { mediaApi, mediaAssignmentsApi, type MediaListQuery } from '../api/media';

export function useMediaLibrary(query: MediaListQuery) {
  return useQuery({
    queryKey: ['media', query],
    queryFn: () => mediaApi.list(query),
    placeholderData: (p) => p,
  });
}

export function useUploadMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, title, altText }: { file: File; title?: string; altText?: string }) =>
      mediaApi.upload(file, { title, altText }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  });
}

export function useUpdateMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MediaAssetUpdateRequest> }) =>
      mediaApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  });
}

export function useDeleteMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mediaApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media'] }),
  });
}

export function useMediaForEntity(entityType: MediaEntityType, entityId: string) {
  return useQuery({
    queryKey: ['media-assignments', entityType, entityId],
    queryFn: () => mediaAssignmentsApi.listForEntity(entityType, entityId),
    enabled: !!entityId,
  });
}

export function useAssignMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MediaAssignmentWriteRequest) => mediaAssignmentsApi.assign(body),
    onSuccess: (_, body) =>
      qc.invalidateQueries({ queryKey: ['media-assignments', body.entityType, body.entityId] }),
  });
}

export function useUnassignMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; entityType: MediaEntityType; entityId: string }) =>
      mediaAssignmentsApi.unassign(id),
    onSuccess: (_, { entityType, entityId }) =>
      qc.invalidateQueries({ queryKey: ['media-assignments', entityType, entityId] }),
  });
}

export function useSetPrimaryMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
    }: {
      id: string;
      entityType: MediaEntityType;
      entityId: string;
    }) => mediaAssignmentsApi.setPrimary(id),
    onSuccess: (_, { entityType, entityId }) =>
      qc.invalidateQueries({ queryKey: ['media-assignments', entityType, entityId] }),
  });
}

export function useReorderMedia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      sortOrder,
    }: {
      id: string;
      sortOrder: number;
      entityType: MediaEntityType;
      entityId: string;
    }) => mediaAssignmentsApi.reorder(id, sortOrder),
    onSuccess: (_, { entityType, entityId }) =>
      qc.invalidateQueries({ queryKey: ['media-assignments', entityType, entityId] }),
  });
}
