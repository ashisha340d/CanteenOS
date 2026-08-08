import type { VoiceModelManifestDto } from '@menuboard/shared';
import { apiClient, unwrap } from './client';

export const voiceModelApi = {
  /**
   * What to download and what it must hash to. The signed URL inside expires, so this is
   * fetched immediately before a download rather than cached.
   */
  async getManifest(): Promise<VoiceModelManifestDto> {
    const response = await apiClient.get('/voice-model/manifest');
    return unwrap(response);
  },
};
