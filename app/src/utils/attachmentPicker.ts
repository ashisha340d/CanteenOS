import * as ImagePicker from 'expo-image-picker';
import type { AttachmentKind } from '@menuboard/shared';
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
