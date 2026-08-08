import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { ApiResponse, AttachmentUploadResult } from '@menuboard/shared';
import { ClientType, HEADERS } from '@menuboard/shared';
import { apiClient, ApiError, unwrap } from './client';
import { getOrCreateDeviceId } from '../utils/deviceId';
import { secureTokenStore } from '../utils/secureTokenStore';

export interface UploadAttachmentInput {
  fileUri: string;
  fileName: string;
  mimeType: string;
  attachmentId: string;
  ownerType: 'ORDER' | 'THREAD_MESSAGE';
  ownerId?: string | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
}

function buildUploadUrl(input: UploadAttachmentInput): string {
  const baseURL = apiClient.defaults.baseURL ?? 'http://10.0.2.2:4000/api/v1';
  const params = new URLSearchParams();
  params.set('attachmentId', input.attachmentId);
  params.set('ownerType', input.ownerType);
  if (input.ownerId) params.set('ownerId', input.ownerId);
  if (input.durationMs !== null && input.durationMs !== undefined) {
    params.set('durationMs', String(input.durationMs));
  }
  if (input.width !== null && input.width !== undefined) {
    params.set('width', String(input.width));
  }
  if (input.height !== null && input.height !== undefined) {
    params.set('height', String(input.height));
  }
  return `${baseURL}/attachments/upload?${params.toString()}`;
}

async function uploadHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = secureTokenStore.getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers[HEADERS.CLIENT_TYPE] = ClientType.ANDROID;
  headers[HEADERS.DEVICE_ID] = await getOrCreateDeviceId();
  return headers;
}

function parseUploadResponse(body: string, status: number): AttachmentUploadResult {
  let parsed: ApiResponse<AttachmentUploadResult>;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Upload failed with status ${status}`);
  }
  if (!parsed.success) {
    throw new ApiError(parsed.error);
  }
  return parsed.data;
}

export const attachmentsApi = {
  async upload(input: UploadAttachmentInput): Promise<AttachmentUploadResult> {
    if (Platform.OS === 'web') {
      // Browsers cannot use React Native's {uri,name,type} file object in FormData. The image
      // picker on web yields a blob: URL, so fetch it locally to get a real Blob/File.
      const fileResponse = await fetch(input.fileUri);
      const blob = await fileResponse.blob();
      const formData = new FormData();
      formData.append('file', blob, input.fileName);
      const response = await apiClient.post('/attachments/upload', formData, {
        params: {
          attachmentId: input.attachmentId,
          ownerType: input.ownerType,
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.durationMs ? { durationMs: input.durationMs } : {}),
          ...(input.width ? { width: input.width } : {}),
          ...(input.height ? { height: input.height } : {}),
        },
      });
      return unwrap(response);
    }

    // Native: axios + React Native FormData is unreliable for multipart uploads from file://
    // URIs; Expo's uploadAsync handles the native multipart wiring correctly.
    const result = await FileSystem.uploadAsync(buildUploadUrl(input), input.fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType: input.mimeType,
      headers: await uploadHeaders(),
    });
    return parseUploadResponse(result.body, result.status);
  },

  async getSignedUrl(attachmentId: string): Promise<string> {
    const response = await apiClient.get<ApiResponse<{ url: string }>>(`/attachments/${attachmentId}/url`);
    return unwrap(response).url;
  },
};
