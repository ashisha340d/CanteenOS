import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config';
import {
  extensionForMimeType,
  kindForMimeType,
  maxBytesForKind,
  resolveMediaPath,
} from '../src/utils/mediaStorage';

describe('resolveMediaPath', () => {
  it('resolves a normal relative storage path under the media root', () => {
    const resolved = resolveMediaPath('image/2026/08/abc123.jpg');
    expect(resolved).toBe(path.resolve(config.media.root, 'image/2026/08/abc123.jpg'));
    expect(resolved.startsWith(path.resolve(config.media.root))).toBe(true);
  });

  it('rejects a path-traversal attempt escaping the media root', () => {
    expect(() => resolveMediaPath('../../../../etc/passwd')).toThrow();
  });

  it('strips a bare leading slash and treats the remainder as relative to the media root', () => {
    // A stored path is never expected to start with '/', but if one ever did (e.g. an older
    // bug), stripping the leading slash and resolving underneath the root is the safe
    // fallback rather than reading the leading slash as filesystem-root-absolute.
    expect(resolveMediaPath('/image/2026/08/abc123.jpg')).toBe(
      path.resolve(config.media.root, 'image/2026/08/abc123.jpg'),
    );
  });

  it('rejects a Windows-style traversal too', () => {
    expect(() => resolveMediaPath('..\\..\\..\\Windows\\System32\\config')).toThrow();
  });

  it('accepts the media root itself', () => {
    expect(() => resolveMediaPath('.')).not.toThrow();
  });
});

describe('media kind/extension/size mapping', () => {
  it('classifies known mime types into the right AttachmentKind', () => {
    expect(kindForMimeType('image/png')).toBe('IMAGE');
    expect(kindForMimeType('audio/m4a')).toBe('VOICE_NOTE');
    expect(kindForMimeType('application/pdf')).toBe('DOCUMENT');
  });

  it('rejects an unsupported mime type', () => {
    expect(() => kindForMimeType('application/x-sh')).toThrow();
  });

  it('maps every supported mime type to a real extension', () => {
    expect(extensionForMimeType('image/jpeg')).toBe('.jpg');
    expect(extensionForMimeType('audio/mpeg')).toBe('.mp3');
  });

  it('gives every kind a positive max byte size', () => {
    expect(maxBytesForKind(kindForMimeType('image/png'))).toBeGreaterThan(0);
    expect(maxBytesForKind(kindForMimeType('audio/aac'))).toBeGreaterThan(0);
    expect(maxBytesForKind(kindForMimeType('application/pdf'))).toBeGreaterThan(0);
  });
});
