/**
 * Guest application file upload.
 *
 * One responsibility: uploading a driver's document during the public
 * application. The server reserves the storage path and validates tenant/rate
 * limits (getSignedUploadUrl); the client then uploads via the Firebase SDK —
 * avoiding a browser PUT to storage.googleapis.com (bucket CORS / signed URL
 * extension headers). Previewing is `useSignedUploadPreview`'s job, and the
 * comment beside `fileData` says why it is not done here.
 *
 * `handleFileUpload(field, file, { onProgress, signal })`: the progress is real
 * (`transferGuestUpload`), the signal cancels, and a file over the Storage limit
 * is refused here before anything is reserved. Every failure is thrown, and
 * shown, as a `GuestUploadError` in words a driver can act on; a cancel is
 * thrown without a message.
 */
import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { GUEST_UPLOAD_MIME_TYPES, resolveGuestUploadMimeType } from '@shared/utils/guestUploadMime';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import {
  GUEST_UPLOAD_MAX_BYTES,
  GuestUploadError,
  toGuestUploadError,
  transferGuestUpload,
} from './guestUploadTransfer';
import { shrinkPhoto } from './guestUploadImage';

/** The E2E double's wait, which a cancel ends early (`?e2eUpload=slow` or `slow:<field>` waits longer). */
function e2eWait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new GuestUploadError('cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new GuestUploadError('cancelled'));
    }, { once: true });
  });
}

export function useGuestFileUpload(companyId) {
  const { showSuccess, showError } = useToast();
  // How many uploads are on their way. A count, not a flag: with two at once,
  // the first to finish must not say the second is done.
  const [inFlight, setInFlight] = useState(0);
  const e2eUploadMode = getE2EQueryParam('e2eUpload', 'allow');

  const handleFileUpload = async (fieldName, chosen, { onProgress, signal } = {}) => {
    if (!chosen) return null;
    setInFlight((count) => count + 1);
    try {
      if (!companyId) {
        throw new Error('Company context is missing.');
      }
      // A big phone photo goes smaller, and so faster; anything else goes as it is.
      const file = await shrinkPhoto(chosen);
      // `storage.rules` refuses it anyway, as a bare "unauthorized".
      if (file.size >= GUEST_UPLOAD_MAX_BYTES) throw new GuestUploadError('too-large');

      if (isE2ETestMode) {
        // `deny` refuses every upload; `deny:<field>` only that one, so a spec can
        // get past the standard documents and watch a later upload fail.
        if (e2eUploadMode === 'deny' || e2eUploadMode === `deny:${fieldName}`) {
          const permissionError = new Error('E2E upload blocked by mock permission guard.');
          permissionError.code = 'permission-denied';
          throw permissionError;
        }

        // `slow` keeps the upload on its way long enough to cancel it; `slow:<field>`
        // only that one's.
        const slow = e2eUploadMode === 'slow' || e2eUploadMode === `slow:${fieldName}`;
        await e2eWait(slow ? 10_000 : 120, signal);
        onProgress?.(1);
        const fileData = {
          name: file.name,
          url: typeof URL !== 'undefined' ? URL.createObjectURL(file) : '',
          storagePath: `companies/${companyId}/applications/e2e/${fieldName}/${Date.now()}-${file.name}`,
        };
        showSuccess("File uploaded successfully.");
        return fileData;
      }

      // Said here, in words, rather than refused by the reservation as a bare code.
      const fileType = resolveGuestUploadMimeType(file);
      if (!GUEST_UPLOAD_MIME_TYPES.includes(fileType)) throw new GuestUploadError('unsupported-type');

      const prepareGuestUpload = httpsCallable(functions, 'getSignedUploadUrl');

      const { data: { storagePath } } = await prepareGuestUpload({
        companyId,
        fileName: file.name,
        fileType,
        folder: 'applications'
      });

      if (!storagePath) {
        throw new Error('Upload prepare failed: missing storage path.');
      }

      await transferGuestUpload(storagePath, file, { contentType: fileType, onProgress, signal });

      /*
       * No `url` is stored, deliberately.
       *
       * `getSignedGuestUploadUrl` mints a read URL that lives FIFTEEN MINUTES, and
       * this used to bake it into the form data — which is persisted into the draft
       * and handed to the driver by the invite exchange. So a document a recruiter
       * attached on Tuesday was a broken image and a Storage error page by the time
       * the driver opened the link. A signed URL is a short-lived capability, not a
       * property of the document; `storagePath` is the durable identifier, and
       * `useSignedUploadPreview` mints a URL from it when somebody is looking.
       *
       * That also drops a round trip from every upload.
       */
      const fileData = { name: file.name, storagePath };
      showSuccess("File uploaded successfully.");
      return fileData;
    } catch (error) {
      const failure = toGuestUploadError(error);
      if (failure.code !== 'cancelled') {
        console.error("Upload Error:", error);
        showError(failure.message);
      }
      throw failure;
    } finally {
      setInFlight((count) => count - 1);
    }
  };

  return { isUploading: inFlight > 0, handleFileUpload };
}
