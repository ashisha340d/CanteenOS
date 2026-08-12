import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    RegisterPasskeyRequest,
    RemovePasskeyRequest,
    RemovePinRequest,
    SetPinRequest,
} from '@menuboard/shared';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { startRegistration } from '@simplewebauthn/browser';
import { authApi } from '@/api/auth';

export function usePinStatus() {
    return useQuery({
        queryKey: ['pin-status'],
        queryFn: () => authApi.getPinStatus(),
    });
}

export function usePasskeys() {
    return useQuery({
        queryKey: ['passkeys'],
        queryFn: () => authApi.listPasskeys(),
    });
}

export function useSetPin() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: SetPinRequest) => authApi.setPin(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['passkeys'] });
            qc.invalidateQueries({ queryKey: ['pin-status'] });
        },
    });
}

export function useRemovePin() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: RemovePinRequest) => authApi.removePin(body),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['passkeys'] });
            qc.invalidateQueries({ queryKey: ['pin-status'] });
        },
    });
}

export function useRegisterPasskey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: async ({
            currentPassword,
            deviceName,
        }: {
            currentPassword: string;
            deviceName?: string;
        }) => {
            const { options } = await authApi.getPasskeyRegisterOptions({
                currentPassword,
                deviceName: deviceName || null,
            });
            const response = await startRegistration({
                optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
            });
            const body: RegisterPasskeyRequest = {
                currentPassword,
                response: response as unknown as Record<string, unknown>,
                deviceName: deviceName || null,
            };
            return authApi.registerPasskey(body);
        },
        onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }),
    });
}

export function useRemovePasskey() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: (body: RemovePasskeyRequest) => authApi.removePasskey(body),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['passkeys'] }),
    });
}
