/**
 * Guest application file upload.
 *
 * One responsibility: uploading a driver's document during the public
 * application. The server reserves the storage path and validates tenant/rate
 * limits (getSignedUploadUrl); the client then uploads via the Firebase SDK —
 * avoiding a browser PUT to storage.googleapis.com (bucket CORS / signed URL
 * extension headers). Previewing is `useSignedUploadPreview`'s job, and the
 * comment beside `fileData` says why it is not done here.
 */
import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { functions, storage } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { resolveGuestUploadMimeType } from '@shared/utils/guestUploadMime';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';

export function useGuestFileUpload(companyId) {
  const { showSuccess, showError } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const e2eUploadMode = getE2EQueryParam('e2eUpload', 'allow');

  const handleFileUpload = async (fieldName, file) => {
    if (!file) return null;
    setIsUploading(true);
    try {
      if (!companyId) {
        throw new Error('Company context is missing.');
      }

      if (isE2ETestMode) {
        if (e2eUploadMode === 'deny') {
          const permissionError = new Error('E2E upload blocked by mock permission guard.');
          permissionError.code = 'permission-denied';
          throw permissionError;
        }

        await new Promise((resolve) => setTimeout(resolve, 120));
        const fileData = {
          name: file.name,
          url: typeof URL !== 'undefined' ? URL.createObjectURL(file) : '',
          storagePath: `companies/${companyId}/applications/e2e/${fieldName}/${Date.now()}-${file.name}`,
        };
        showSuccess("File uploaded successfully.");
        return fileData;
      }

      const fileType = resolveGuestUploadMimeType(file);
      if (!fileType) {
        throw new Error('Could not detect file type. Please use PDF, PNG, JPEG, WEBP, or HEIC.');
      }

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

      const fileRef = ref(storage, storagePath);
      await uploadBytes(fileRef, file, { contentType: fileType });

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
      console.error("Upload Error:", error);
      if (error?.code === 'functions/resource-exhausted') {
        showError("Too many upload attempts. Please wait a moment and try again.");
      } else if (error?.code === 'storage/unauthorized') {
        showError("Upload was denied by Firebase Storage. Please refresh and try again.");
      } else {
        showError("Upload failed. Please try again.");
      }
      throw error;
    } finally {
      setIsUploading(false);
    }
  };

  return { isUploading, handleFileUpload };
}
