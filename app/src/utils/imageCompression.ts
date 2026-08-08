import { MEDIA } from '@menuboard/shared';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const CACHE_DIR = `${FileSystem.cacheDirectory}menuboard/images/`;

interface CompressedImage {
  uri: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

function targetDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number,
): { width: number; height: number } {
  const max = Math.max(originalWidth, originalHeight);
  if (max <= maxDimension) {
    return { width: originalWidth, height: originalHeight };
  }
  const scale = maxDimension / max;
  return {
    width: Math.round(originalWidth * scale),
    height: Math.round(originalHeight * scale),
  };
}

/**
 * Resizes and compresses a captured photo before it enters the attachment upload queue.
 * Uses the shared MEDIA constants so the app and backend agree on the target.
 */
export async function compressImageForUpload(
  sourceUri: string,
  originalWidth: number,
  originalHeight: number,
): Promise<CompressedImage> {
  await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });

  const { width, height } = targetDimensions(
    originalWidth,
    originalHeight,
    MEDIA.IMAGE_COMPRESS_MAX_DIMENSION,
  );

  const outputUri = `${CACHE_DIR}${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const result = await manipulateAsync(
    sourceUri,
    [{ resize: { width, height } }],
    {
      compress: MEDIA.IMAGE_COMPRESS_QUALITY,
      format: SaveFormat.JPEG,
      base64: false,
    },
  );

  await FileSystem.moveAsync({
    from: result.uri,
    to: outputUri,
  });

  const info = await FileSystem.getInfoAsync(outputUri);
  const sizeBytes = info.exists && 'size' in info ? info.size : 0;

  return {
    uri: outputUri,
    width,
    height,
    sizeBytes,
    mimeType: 'image/jpeg',
  };
}
