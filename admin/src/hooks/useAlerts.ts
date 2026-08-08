import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertSoundSlot, AlertType, UpdateAlertSettingRequest } from '@menuboard/shared';
import { alertsApi } from '../api/alerts';

export function useAlertSettings() {
  return useQuery({ queryKey: ['alert-settings'], queryFn: alertsApi.listSettings });
}

export function useAlertSounds() {
  return useQuery({ queryKey: ['alert-sounds'], queryFn: alertsApi.listSounds });
}

export function useUpdateAlertSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ alertType, body }: { alertType: AlertType; body: UpdateAlertSettingRequest }) =>
      alertsApi.updateSetting(alertType, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-settings'] }),
  });
}

export function useUploadAlertSound() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slot, file }: { slot: AlertSoundSlot; file: File }) =>
      alertsApi.uploadSound(slot, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-sounds'] }),
  });
}
