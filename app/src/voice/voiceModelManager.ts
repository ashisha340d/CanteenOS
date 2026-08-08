import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { VoiceModelManifestDto } from '@menuboard/shared';
import { voiceModelApi } from '../api/voiceModel';
import { sha256File } from './whisperModule';
import type { InstalledVoicePack, VoicePackError } from './types';

/**
 * Installation and lifecycle of the offline speech model.
 *
 * The weights live in app-private storage (`documentDirectory`), never in a public Downloads
 * folder — they are an application asset, not a user document, and putting them somewhere a
 * file manager can delete would produce a broken feature with no obvious cause.
 *
 * Three invariants hold:
 *
 *   1. **Nothing is activated unverified.** The download lands on a `.part` path and is only
 *      renamed into place after its SHA-256 matches the manifest. A truncated model fails as
 *      gibberish transcription rather than an error, so this check is what keeps a bad
 *      download from looking like a bad feature.
 *   2. **The metadata file is written last.** Its presence is what "installed" means, so a
 *      process killed mid-install leaves no half-state — just an orphan `.part` to clean up.
 *   3. **Updates never destroy a working model.** The replacement is downloaded and verified
 *      alongside the current one; the old file is removed only once the new one is in place.
 */

const VOICE_DIR = `${FileSystem.documentDirectory}voice-model/`;
const MODEL_FILE = `${VOICE_DIR}ggml-base.bin`;
const PART_FILE = `${VOICE_DIR}ggml-base.bin.part`;
const META_FILE = `${VOICE_DIR}installed.json`;

export type DownloadProgress = (progress: {
  receivedBytes: number;
  totalBytes: number;
  fraction: number;
}) => void;

/** Thrown with a classified kind so the UI can offer a matching recovery action. */
export class VoicePackFailure extends Error {
  constructor(readonly detail: VoicePackError) {
    super(detail.message);
    this.name = 'VoicePackFailure';
  }
}

function fail(kind: VoicePackError['kind'], message: string): never {
  throw new VoicePackFailure({ kind, message });
}

async function ensureDirectory(): Promise<void> {
  const info = await FileSystem.getInfoAsync(VOICE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(VOICE_DIR, { intermediates: true });
  }
}

let activeDownload: FileSystem.DownloadResumable | null = null;

export const voiceModelManager = {
  modelPath(): string {
    return MODEL_FILE;
  },

  /** The installed pack, or null when nothing is installed. */
  async getInstalled(): Promise<InstalledVoicePack | null> {
    // The web shim has no whisper.cpp, so a downloaded model there would be dead weight.
    if (Platform.OS === 'web') return null;

    try {
      const meta = await FileSystem.getInfoAsync(META_FILE);
      if (!meta.exists) return null;

      const raw = await FileSystem.readAsStringAsync(META_FILE);
      const parsed = JSON.parse(raw) as InstalledVoicePack;

      // Metadata without weights is a broken install, not an install.
      const model = await FileSystem.getInfoAsync(MODEL_FILE);
      if (!model.exists) {
        await FileSystem.deleteAsync(META_FILE, { idempotent: true });
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  },

  /** Bytes the pack occupies on disk, for the Settings screen. */
  async getStorageUsedBytes(): Promise<number> {
    const info = await FileSystem.getInfoAsync(MODEL_FILE);
    return info.exists && 'size' in info ? info.size : 0;
  },

  async fetchManifest(): Promise<VoiceModelManifestDto> {
    try {
      return await voiceModelApi.getManifest();
    } catch (error) {
      // No HTTP response at all means the request never reached the server.
      const reachedServer = (error as { response?: unknown }).response !== undefined;
      if (!reachedServer) {
        fail('OFFLINE', 'No connection. Connect to the internet to download the voice pack.');
      }
      fail('SERVER_UNAVAILABLE', 'The voice pack is not available on the server right now.');
    }
  },

  /** True when the server advertises a version different from the one installed. */
  async isUpdateAvailable(manifest: VoiceModelManifestDto): Promise<boolean> {
    const installed = await this.getInstalled();
    return installed !== null && installed.version !== manifest.version;
  },

  /**
   * Downloads, verifies and activates the model.
   *
   * Resumable, so a dropped connection continues from where it stopped rather than starting
   * a 148 MB transfer again. Safe to call when a model is already installed — that is the
   * update path, and the existing model stays usable until the new one has been verified.
   */
  async install(
    manifest: VoiceModelManifestDto,
    onProgress?: DownloadProgress,
  ): Promise<InstalledVoicePack> {
    if (Platform.OS === 'web') {
      fail(
        'UNSUPPORTED_PLATFORM',
        'Offline voice orders need the Android app. The browser uses its own speech recognition.',
      );
    }

    await ensureDirectory();

    // Refuse before writing anything rather than filling the disk and failing at the end.
    // The margin covers the verified file living beside its `.part` during the rename.
    const free = await FileSystem.getFreeDiskStorageAsync();
    if (free < manifest.sizeBytes * 1.2) {
      fail(
        'STORAGE_FULL',
        `Not enough space. The voice pack needs about ${formatBytes(manifest.sizeBytes)} free.`,
      );
    }

    const download = FileSystem.createDownloadResumable(
      manifest.downloadUrl,
      PART_FILE,
      {},
      (progress) => {
        const total = progress.totalBytesExpectedToWrite || manifest.sizeBytes;
        onProgress?.({
          receivedBytes: progress.totalBytesWritten,
          totalBytes: total,
          fraction: total > 0 ? progress.totalBytesWritten / total : 0,
        });
      },
    );
    activeDownload = download;

    let result: FileSystem.FileSystemDownloadResult | undefined;
    try {
      result = await download.downloadAsync();
    } catch (error) {
      // A cancel resolves through this path too; the caller distinguishes them by having
      // called `cancel()`.
      if (activeDownload === null) fail('CANCELLED', 'Download cancelled.');
      fail('OFFLINE', 'The download was interrupted. Reconnect and tap Retry.');
    } finally {
      activeDownload = null;
    }

    if (result === undefined) {
      fail('CANCELLED', 'Download cancelled.');
    }

    // Verify before activating. An unverified model is worse than no model, because its
    // failures look like poor recognition rather than a corrupt file.
    const digest = await sha256File(PART_FILE);
    if (digest.toLowerCase() !== manifest.sha256.toLowerCase()) {
      await FileSystem.deleteAsync(PART_FILE, { idempotent: true });
      fail(
        'CHECKSUM_MISMATCH',
        'The downloaded voice pack was damaged in transit. Tap Retry to download it again.',
      );
    }

    await FileSystem.deleteAsync(MODEL_FILE, { idempotent: true });
    await FileSystem.moveAsync({ from: PART_FILE, to: MODEL_FILE });

    const installed: InstalledVoicePack = {
      version: manifest.version,
      model: manifest.model,
      sha256: manifest.sha256,
      sizeBytes: manifest.sizeBytes,
      installedAt: new Date().toISOString(),
      filePath: MODEL_FILE,
    };
    // Written last: its presence is the definition of "installed".
    await FileSystem.writeAsStringAsync(META_FILE, JSON.stringify(installed));
    return installed;
  },

  /** Aborts an in-flight download and discards the partial file. */
  async cancel(): Promise<void> {
    const download = activeDownload;
    activeDownload = null;
    if (download !== null) {
      try {
        await download.pauseAsync();
      } catch {
        // Already finished or never started; the partial file is removed either way.
      }
    }
    await FileSystem.deleteAsync(PART_FILE, { idempotent: true });
  },

  /** Removes the pack. Voice orders fall back to manual entry afterwards. */
  async uninstall(): Promise<void> {
    await FileSystem.deleteAsync(MODEL_FILE, { idempotent: true });
    await FileSystem.deleteAsync(PART_FILE, { idempotent: true });
    await FileSystem.deleteAsync(META_FILE, { idempotent: true });
  },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
