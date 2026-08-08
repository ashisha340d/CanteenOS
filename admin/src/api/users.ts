import type { CreateUserRequest, PageQuery, UpdateUserRequest, UserDto, UserRole, UserStatus } from '@menuboard/shared';
import { http, unwrapPaged, unwrap } from './client';

export interface UserListQuery extends PageQuery {
  role?: UserRole;
  status?: UserStatus;
}

export const usersApi = {
  list: (query: UserListQuery) => unwrapPaged<UserDto>(http.get('/users', { params: query })),
  get: (id: string) => unwrap<UserDto>(http.get(`/users/${id}`)),
  create: (body: CreateUserRequest) => unwrap<UserDto>(http.post('/users', body)),
  update: (id: string, body: UpdateUserRequest) => unwrap<UserDto>(http.patch(`/users/${id}`, body)),
  remove: (id: string) => unwrap<null>(http.delete(`/users/${id}`)),
};
