import { describe, expect, it } from 'vitest';
import { resolveGuestUploadMimeType } from './guestUploadMime';

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
