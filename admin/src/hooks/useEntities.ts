import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityListQuery, EntityWriteRequest } from '@menuboard/shared';
import { entitiesApi } from '../api/entities';

export function useEntities(query: EntityListQuery) {
  return useQuery({
    queryKey: ['entities', query],
    queryFn: () => entitiesApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useEntity(id: string | null) {
  return useQuery({
    queryKey: ['entity', id],
    queryFn: () => entitiesApi.get(id as string),
    enabled: id !== null && id !== '',
  });
}

/**
 * Counter lookup by phone.
 *
 * Only fires once the number looks like one — a query per keystroke from the first digit
 * would be four wasted round trips before the answer could possibly be useful.
 */
export function useEntityByPhone(phone: string) {
  const trimmed = phone.trim();
  return useQuery({
    queryKey: ['entity-by-phone', trimmed],
    queryFn: () => entitiesApi.lookupByPhone(trimmed),
    enabled: trimmed.length >= 6,
  });
}

export function useCreateEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EntityWriteRequest) => entitiesApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities'] }),
  });
}

export function useUpdateEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<EntityWriteRequest> }) =>
      entitiesApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities'] }),
  });
}

export function useDeleteEntity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => entitiesApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entities'] }),
  });
}
