import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { YOUTUBE_IMPORT_ACTIVE_STATUSES } from '@menuboard/shared';
import { youtubeImportsApi, type YoutubeImportListQuery } from '../api/youtubeImports';

/**
 * The list polls while anything is still processing so progress moves without a manual
 * refresh, and goes quiet once every import has settled (READY/FAILED/SAVED).
 */
export function useYoutubeImports(query: YoutubeImportListQuery = {}) {
  return useQuery({
    queryKey: ['youtube-imports', query],
    queryFn: () => youtubeImportsApi.list(query),
    placeholderData: (p) => p,
    refetchInterval: (q) =>
      (q.state.data ?? []).some((row) => YOUTUBE_IMPORT_ACTIVE_STATUSES.includes(row.status))
        ? 3_000
        : false,
  });
}

export function useYoutubeImport(id: string | undefined) {
  return useQuery({
    queryKey: ['youtube-import', id],
    queryFn: () => youtubeImportsApi.getById(id as string),
    enabled: Boolean(id),
  });
}

export function useCreateYoutubeImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => youtubeImportsApi.create(url),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['youtube-imports'] }),
  });
}

export function useRetryYoutubeImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => youtubeImportsApi.retry(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['youtube-imports'] });
      qc.invalidateQueries({ queryKey: ['youtube-import'] });
    },
  });
}

export function useDeleteYoutubeImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => youtubeImportsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['youtube-imports'] }),
  });
}
