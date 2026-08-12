import type {
  MyTasksDto,
  TaskCreateRequest,
  TaskDto,
  TeamMemberActivityDto,
} from '@menuboard/shared';
import { apiClient, unwrap } from './client';

/**
 * Volunteer tasks.
 *
 * Deliberately **online-only**, like `shoppingApi`: tasks do not take part in the delta-sync
 * engine, so this module talks to the server directly and the screens treat a failed request
 * as an ordinary outcome rather than an exception. Starting a task must be authoritative —
 * two devices queuing an offline "start" would both believe they own the work.
 */
export const tasksApi = {
  async mine(): Promise<MyTasksDto> {
    return unwrap(await apiClient.get('/tasks/mine'));
  },

  async teamActivity(): Promise<TeamMemberActivityDto[]> {
    return unwrap(await apiClient.get('/tasks/team-activity'));
  },

  async create(input: TaskCreateRequest): Promise<TaskDto> {
    return unwrap(await apiClient.post('/tasks', input));
  },

  async start(id: string): Promise<TaskDto> {
    return unwrap(await apiClient.post(`/tasks/${id}/start`));
  },

  async stop(id: string): Promise<TaskDto> {
    return unwrap(await apiClient.post(`/tasks/${id}/stop`));
  },

  async complete(id: string): Promise<TaskDto> {
    return unwrap(await apiClient.post(`/tasks/${id}/complete`));
  },
};
