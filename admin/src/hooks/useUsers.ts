import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserRequest, UpdateUserRequest } from '@menuboard/shared';
import { usersApi, type UserListQuery } from '../api/users';

export function useUsers(query: UserListQuery) {
  return useQuery({
    queryKey: ['users', query],
    queryFn: () => usersApi.list(query),
    placeholderData: (prev) => prev,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserRequest) => usersApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserRequest }) => usersApi.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
