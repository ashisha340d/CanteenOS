import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TaskCreateRequest, TaskUpdateRequest } from '@menuboard/shared';
import { tasksApi, type TaskListQuery } from '../api/tasks';

export function useTasks(query: TaskListQuery) {
  return useQuery({
    queryKey: ['tasks', query],
    queryFn: () => tasksApi.list(query),
    placeholderData: (previous) => previous,
  });
}

export function useTeamActivity() {
  return useQuery({
    queryKey: ['task-team-activity'],
    queryFn: () => tasksApi.teamActivity(),
    // Who is free changes as people work, not as the page is navigated.
    refetchInterval: 60_000,
  });
}

function useTaskMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task-team-activity'] });
    },
  });
}

export function useCreateTask() {
  return useTaskMutation((body: TaskCreateRequest) => tasksApi.create(body));
}

export function useUpdateTask() {
  return useTaskMutation(({ id, body }: { id: string; body: TaskUpdateRequest }) =>
    tasksApi.update(id, body),
  );
}

export function useCancelTask() {
  return useTaskMutation((id: string) => tasksApi.cancel(id));
}

export function useDeleteTask() {
  return useTaskMutation((id: string) => tasksApi.remove(id));
}
