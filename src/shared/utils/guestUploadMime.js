/**
 * The types `getSignedUploadUrl` reserves a path for (`functions/storageSecure.js`
 * `ALLOWED_MIME_TYPES`, checked against this list by `guestUploadMime.test.js`).
 * Anything else, a GIF the picker's `image/*` lets through for one, is refused
 * there as a bare `invalid-argument`.
 */
export const GUEST_UPLOAD_MIME_TYPES = Object.freeze([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/**
 * MIME type for guest Storage uploads. Some mobile browsers leave `File.type` empty;
 * Storage rules require a real `image/*` or PDF on `request.resource.contentType`.
 */
export function resolveGuestUploadMimeType(file) {
  const raw = String(file?.type ?? '').trim();
  if (raw) return raw;
  const name = String(file?.name ?? '').toLowerCase();
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.heic') || name.endsWith('.heif')) return 'image/heic';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  return '';
}
