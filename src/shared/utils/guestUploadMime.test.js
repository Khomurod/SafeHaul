import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GUEST_UPLOAD_MIME_TYPES, resolveGuestUploadMimeType } from './guestUploadMime';

describe('resolveGuestUploadMimeType', () => {
  it('uses File.type when present', () => {
    expect(resolveGuestUploadMimeType({ type: 'image/jpeg', name: 'x.bin' })).toBe('image/jpeg');
  });

  it('infers from extension when type is empty', () => {
    expect(resolveGuestUploadMimeType({ type: '', name: 'IMG_1856.jpeg' })).toBe('image/jpeg');
    expect(resolveGuestUploadMimeType({ type: '   ', name: 'doc.PDF' })).toBe('application/pdf');
  });

  it('supports iPhone camera extensions', () => {
    expect(resolveGuestUploadMimeType({ type: '', name: 'IMG.HEIC' })).toBe('image/heic');
    expect(resolveGuestUploadMimeType({ type: '', name: 'x.heif' })).toBe('image/heic');
  });

  it('returns empty for unknown extension', () => {
    expect(resolveGuestUploadMimeType({ type: '', name: 'file.xyz' })).toBe('');
  });
});

describe('GUEST_UPLOAD_MIME_TYPES', () => {
  it('is the list the upload reservation accepts, so a refusal there is said here first', () => {
    // Read as text: the callable's module needs the functions dependencies, which
    // the frontend job does not install.
    const source = readFileSync(resolve(__dirname, '../../../functions/storageSecure.js'), 'utf8');
    const list = source.match(/const ALLOWED_MIME_TYPES = \[([^\]]*)\]/);
    expect(list).not.toBeNull();
    const server = [...list[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
    expect([...GUEST_UPLOAD_MIME_TYPES].sort()).toEqual(server.sort());
  });
});
