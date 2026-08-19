import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { AttachmentKind } from '@menuboard/shared';
import { MEDIA } from '@menuboard/shared';
import { compressImageForUpload } from './imageCompression';
import { newId } from './uuid';

/**
 * Picks a photo for the feed and gets it upload-ready in one step.
 *
 * Photos are resized and re-encoded before they ever reach the outbox, per the spec's
 * "photos optimised automatically for web use": a 12 MP phone capture sent raw over a kitchen
 * Wi-Fi connection is the difference between a message that arrives and one that sits in the
 * queue all evening.
 *
 * Returns null when the user backs out — a cancelled picker is not an error.
 */
export interface PickedAttachment {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  uri: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export async function pickBoardAttachment(): Promise<PickedAttachment | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 1,
    allowsMultipleSelection: false,
  });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (asset === undefined) return null;

  const compressed = await compressImageForUpload(
    asset.uri,
    asset.width ?? 0,
    asset.height ?? 0,
  );

  return {
    kind: 'IMAGE',
    fileName: asset.fileName ?? `photo-${newId()}.jpg`,
    mimeType: compressed.mimeType,
    uri: compressed.uri,
    sizeBytes: compressed.sizeBytes,
    width: compressed.width,
    height: compressed.height,
  };
}

/**
 * The equipment module's photo capture.
 *
 * Separate entry point from `pickBoardAttachment` because registering an asset starts at the
 * camera — the whole point is that somebody standing in front of a machine photographs its
 * rating plate — while the library remains available for a picture already taken. Same
 * compression, because a 12 MP plate photo has to survive a basement Wi-Fi connection.
 */
export async function pickEquipmentPhoto(
  source: 'camera' | 'library',
): Promise<PickedAttachment | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsMultipleSelection: false,
      });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (asset === undefined) return null;

  const compressed = await compressImageForUpload(asset.uri, asset.width ?? 0, asset.height ?? 0);
  return {
    kind: 'IMAGE',
    fileName: asset.fileName ?? `equipment-${newId()}.jpg`,
    mimeType: compressed.mimeType,
    uri: compressed.uri,
    sizeBytes: compressed.sizeBytes,
    width: compressed.width,
    height: compressed.height,
  };
}

/* ---------------------------------------------------------------- fault video */

export interface PickedVideo {
  uri: string;
  fileName: string;
  mimeType: string;
  /** Absent only when neither the picker nor the filesystem could report a size. */
  sizeBytes?: number;
}

/**
 * Either a clip to upload, a shrug, or a sentence to put in front of the user.
 *
 * A refusal carries its own wording because the two reasons need different words — a denied
 * permission is a settings problem, an oversized clip is a "film less" problem — and both have
 * to be said on the screen rather than swallowed.
 */
export type VideoPickOutcome =
  | { status: 'PICKED'; video: PickedVideo }
  | { status: 'CANCELLED' }
  | { status: 'REFUSED'; message: string };

const VIDEO_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
};

const EXTENSION_BY_VIDEO_MIME: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

/** Coerces whatever the picker reports onto one of the three types the server accepts. */
function videoMimeType(asset: ImagePicker.ImagePickerAsset): string {
  const accepted = MEDIA.VIDEO_MIME_TYPES as readonly string[];
  const reported = asset.mimeType;
  if (reported !== undefined && accepted.includes(reported)) return reported;
  const extension = (asset.fileName ?? asset.uri).split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_MIME_BY_EXTENSION[extension] ?? MEDIA.VIDEO_MIME_TYPES[0];
}

/** Null when the size is genuinely unknowable, in which case the server's own limit decides. */
async function videoSizeBytes(asset: ImagePicker.ImagePickerAsset): Promise<number | null> {
  if (asset.fileSize !== undefined) return asset.fileSize;
  // The browser dev target hands back a `blob:` URI the filesystem cannot stat.
  const info = await FileSystem.getInfoAsync(asset.uri).catch(() => null);
  if (info === null) return null;
  return info.exists && 'size' in info ? info.size : null;
}

function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

/**
 * The equipment module's fault video — "a noise, a leak, a flame that will not hold".
 *
 * Video is **not** compressed: the app carries no transcoder (`expo-image-manipulator` handles
 * stills only) and none may be added, so the recording ceiling and the size check below are the
 * only things standing between a reporter and a multipart POST that dies minutes later. Both
 * limits come from `MEDIA`, so the phone refuses exactly what the server would.
 */
export async function pickEquipmentVideo(
  source: 'camera' | 'library',
): Promise<VideoPickOutcome> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: 'REFUSED',
      message:
        source === 'camera'
          ? 'Camera access was refused, so a clip cannot be filmed. A photo or a written ' +
          'description works just as well.'
          : 'Access to your videos was refused, so a clip cannot be chosen. Film one with the ' +
          'camera instead.',
    };
  }

  const options = {
    mediaTypes: ['videos'] as ImagePicker.MediaType[],
    videoMaxDuration: MEDIA.VIDEO_MAX_DURATION_SECONDS,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: false });
  if (result.canceled) return { status: 'CANCELLED' };

  const asset = result.assets[0];
  if (asset === undefined) return { status: 'CANCELLED' };

  const mimeType = videoMimeType(asset);
  const sizeBytes = await videoSizeBytes(asset);
  if (sizeBytes !== null && sizeBytes > MEDIA.VIDEO_MAX_BYTES) {
    return {
      status: 'REFUSED',
      message: `That clip is ${megabytes(sizeBytes)} MB and the limit is ${megabytes(
        MEDIA.VIDEO_MAX_BYTES,
      )} MB. Film just the fault — ${MEDIA.VIDEO_MAX_DURATION_SECONDS} seconds of it is enough.`,
    };
  }

  return {
    status: 'PICKED',
    video: {
      uri: asset.uri,
      fileName: asset.fileName ?? `fault-${newId()}.${EXTENSION_BY_VIDEO_MIME[mimeType] ?? 'mp4'}`,
      mimeType,
      ...(sizeBytes === null ? {} : { sizeBytes }),
    },
  };
}
