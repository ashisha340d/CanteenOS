import type { YoutubeImportDto, YoutubeImportStatus } from '@menuboard/shared';
import { http, unwrap } from './client';

export interface YoutubeImportListQuery {
  status?: YoutubeImportStatus;
}

export const youtubeImportsApi = {
  list: (query: YoutubeImportListQuery = {}) =>
    unwrap<YoutubeImportDto[]>(http.get('/youtube-imports', { params: query })),
  getById: (id: string) => unwrap<YoutubeImportDto>(http.get(`/youtube-imports/${id}`)),
  create: (url: string) => unwrap<YoutubeImportDto>(http.post('/youtube-imports', { url })),
  retry: (id: string) => unwrap<YoutubeImportDto>(http.post(`/youtube-imports/${id}/retry`)),
  markSaved: (id: string, recipeId: string) =>
    unwrap<YoutubeImportDto>(http.post(`/youtube-imports/${id}/saved`, { recipeId })),
  remove: (id: string) => unwrap<null>(http.delete(`/youtube-imports/${id}`)),
};
