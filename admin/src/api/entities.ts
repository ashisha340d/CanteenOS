import type {
  EntityDto,
  EntityListQuery,
  EntityWriteRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

/**
 * The Entity master — customers, employees, vendors and anyone else a bill is raised for.
 */
export const entitiesApi = {
  list: (query: EntityListQuery) => unwrapPaged<EntityDto>(http.get('/entities', { params: query })),
  get: (id: string) => unwrap<EntityDto>(http.get(`/entities/${id}`)),
  /** Counter lookup by phone. Resolves to null when nobody matches — a miss is normal. */
  lookupByPhone: (phone: string) =>
    unwrap<EntityDto | null>(http.get('/entities/lookup', { params: { phone } })),
  create: (body: EntityWriteRequest) => unwrap<EntityDto>(http.post('/entities', body)),
  update: (id: string, body: Partial<EntityWriteRequest>) =>
    unwrap<EntityDto>(http.patch(`/entities/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/entities/${id}`)),
};
