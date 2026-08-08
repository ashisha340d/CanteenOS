import type {
  BoardDto,
  BoardMemberDto,
  BoardStatus,
  BoardWithMembersDto,
  CreateBoardRequest,
  PageQuery,
  UpdateBoardRequest,
  UpsertBoardMemberRequest,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface BoardListQuery extends PageQuery {
  status?: BoardStatus;
  stationId?: string;
  withCounts?: boolean;
}

export const boardsApi = {
  list: (query: BoardListQuery) => unwrapPaged<BoardDto>(http.get('/boards', { params: query })),
  get: (boardId: string) => unwrap<BoardWithMembersDto>(http.get(`/boards/${boardId}`)),
  create: (body: CreateBoardRequest) => unwrap<BoardDto>(http.post('/boards', body)),
  update: (boardId: string, body: UpdateBoardRequest) =>
    unwrap<BoardDto>(http.patch(`/boards/${boardId}`, body)),
  archive: (boardId: string) => unwrap<BoardDto>(http.post(`/boards/${boardId}/archive`)),
  listMembers: (boardId: string) => unwrap<BoardMemberDto[]>(http.get(`/boards/${boardId}/members`)),
  upsertMember: (boardId: string, body: UpsertBoardMemberRequest) =>
    unwrap<BoardMemberDto>(http.put(`/boards/${boardId}/members`, body)),
  removeMember: (boardId: string, userId: string) =>
    unwrap<null>(http.delete(`/boards/${boardId}/members/${userId}`)),
};
