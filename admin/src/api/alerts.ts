import type {
  AlertSettingDto,
  AlertSoundDto,
  AlertSoundSlot,
  AlertType,
  UpdateAlertSettingRequest,
} from '@menuboard/shared';
import { http, unwrap } from './client';

export const alertsApi = {
  listSettings: () => unwrap<AlertSettingDto[]>(http.get('/alerts/settings')),
  listSounds: () => unwrap<AlertSoundDto[]>(http.get('/alerts/sounds')),
  updateSetting: (alertType: AlertType, body: UpdateAlertSettingRequest) =>
    unwrap<AlertSettingDto>(http.patch(`/alerts/settings/${alertType}`, body)),
  uploadSound: (slot: AlertSoundSlot, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<AlertSoundDto>(
      http.post(`/alerts/sounds/${slot}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },
  /** Fetched as a blob (rather than used directly as an `<audio>` src) so the bearer token
   *  can be attached — the download route is behind the ordinary authenticated router. */
  fetchSoundBlob: async (slot: AlertSoundSlot): Promise<Blob> => {
    const response = await http.get(`/alerts/sounds/${slot}/file`, { responseType: 'blob' });
    return response.data as Blob;
  },
};
