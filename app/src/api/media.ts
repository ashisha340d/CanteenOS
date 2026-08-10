import type { ApiResponse, MediaAssetDto } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

/**
 * Media downloads are authorised by a signed, expiring query string rather than a bearer
 * header (an <Image> cannot send headers), so the device asks for a fresh link when it is
 * about to render one. Links are cached per asset for a little under the server's own TTL
 * (MEDIA_URL_TTL_MINUTES, 120 by default), which keeps a scrolling list to one call per image.
 */
const URL_CACHE_MS = 60 * 60 * 1000;

const cache = new Map<string, { url: string; fetchedAt: number }>();
const inFlight = new Map<string, Promise<string>>();

export const mediaApi = {
  async getSignedUrl(mediaId: string): Promise<string> {
    const cached = cache.get(mediaId);
    if (cached && Date.now() - cached.fetchedAt < URL_CACHE_MS) return cached.url;

    const existing = inFlight.get(mediaId);
    if (existing) return existing;

    const request = (async () => {
      try {
        const response = await apiClient.get<ApiResponse<MediaAssetDto>>(`/media/${mediaId}`);
        const { url } = unwrap(response);
        cache.set(mediaId, { url, fetchedAt: Date.now() });
        return url;
      } finally {
        inFlight.delete(mediaId);
      }
    })();
    inFlight.set(mediaId, request);
    return request;
  },
};
