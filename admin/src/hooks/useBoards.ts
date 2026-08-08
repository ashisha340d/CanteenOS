import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateBoardRequest, UpdateBoardRequest, UpsertBoardMemberRequest } from '@menuboard/shared';
import { boardsApi, type BoardListQuery } from '../api/boards';

export function useBoards(query: BoardListQuery) {
  return useQuery({
    queryKey: ['boards', query],
    queryFn: () => boardsApi.list(query),
    placeholderData: (prev) => prev,
  });
}

export function useBoard(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board', boardId],
    queryFn: () => boardsApi.get(boardId as string),
    enabled: Boolean(boardId),
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBoardRequest) => boardsApi.create(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  });
}

export function useUpdateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ boardId, body }: { boardId: string; body: UpdateBoardRequest }) => boardsApi.update(boardId, body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['boards'] });
      qc.invalidateQueries({ queryKey: ['board', vars.boardId] });
    },
  });
}

export function useArchiveBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (boardId: string) => boardsApi.archive(boardId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards'] }),
  });
}

export function useBoardMembers(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board-members', boardId],
    queryFn: () => boardsApi.listMembers(boardId as string),
    enabled: Boolean(boardId),
  });
}

export function useUpsertBoardMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpsertBoardMemberRequest) => boardsApi.upsertMember(boardId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-members', boardId] }),
  });
}

export function useRemoveBoardMember(boardId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => boardsApi.removeMember(boardId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['board-members', boardId] }),
  });
}
