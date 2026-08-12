import type {
  MyTasksDto,
  PageQuery,
  TaskCreateRequest,
  TaskDto,
  TaskKind,
  TaskSource,
  TaskStatus,
  TaskUpdateRequest,
  TeamMemberActivityDto,
} from '@menuboard/shared';
import { http, unwrap, unwrapPaged } from './client';

export interface TaskListQuery extends PageQuery {
  assignedTo?: string;
  status?: TaskStatus;
  source?: TaskSource;
  kind?: TaskKind;
}

export const tasksApi = {
  list: (query: TaskListQuery) => unwrapPaged<TaskDto>(http.get('/tasks', { params: query })),
  get: (id: string) => unwrap<TaskDto>(http.get(`/tasks/${id}`)),
  mine: () => unwrap<MyTasksDto>(http.get('/tasks/mine')),
  teamActivity: () => unwrap<TeamMemberActivityDto[]>(http.get('/tasks/team-activity')),
  create: (body: TaskCreateRequest) => unwrap<TaskDto>(http.post('/tasks', body)),
  update: (id: string, body: TaskUpdateRequest) =>
    unwrap<TaskDto>(http.patch(`/tasks/${id}`, body)),
  cancel: (id: string) => unwrap<TaskDto>(http.post(`/tasks/${id}/cancel`)),
  remove: (id: string) => unwrap<null>(http.delete(`/tasks/${id}`)),
};
