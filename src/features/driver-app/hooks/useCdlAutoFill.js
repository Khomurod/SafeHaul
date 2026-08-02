/**
 * CDL auto-fill workflow for the public application.
 *
 * One responsibility: turn a CDL photo into form-field values — upload the
 * image to the guest autofill path (reliability/audit/debug), run the secure
 * server-side Groq parser (no API key in the frontend), and hand back a
 * formData updater with the parsed fields.
 *
 * Navigation side effects stay with the caller:
 *  - `onAutoFilled(updater)` fires on success (apply fields + enter the wizard);
 *  - `onReturnToChooser()` fires when the picker is dismissed, validation
 *    fails, or parsing errors — the driver stays on the choice screen instead
 *    of being force-routed into the manual wizard.
 */
import { useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { functions, storage } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { parseAddressPartsFromCdl } from '@shared/utils/parseCdlAddress';
import {
  AUTO_FILL_IMAGE_TYPES,
  parseIsoFromLooseDate,
  fileToDataUrl,
} from '../components/application/publicApplyHelpers';

export function useCdlAutoFill({ companyId, onAutoFilled, onReturnToChooser }) {
  const { showSuccess, showError } = useToast();
  const [isParsingCdl, setIsParsingCdl] = useState(false);
  const [autoFillStoragePath, setAutoFillStoragePath] = useState('');
  const cdlInputRef = useRef(null);

  const handleChooseAutoFill = () => {
    // Keep the user on the choice screen until a file is actually selected.
    // This prevents an accidental fallback into the manual wizard when the
    // picker is dismissed or blocked by the browser.
    cdlInputRef.current?.click();
  };

  const handleCdlFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      // User closed chooser without selecting a file -> return to first choice screen.
      onReturnToChooser();
      return;
    }

    if (!AUTO_FILL_IMAGE_TYPES.has(file.type)) {
      showError('Please upload a JPG, PNG, or WEBP image for CDL auto-fill.');
      onReturnToChooser();
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      showError('CDL image is too large. Please use an image under 8MB.');
      onReturnToChooser();
      return;
    }

    try {
      if (!companyId) {
        throw new Error('Company is missing. Please refresh and try again.');
      }

      setIsParsingCdl(true);

      // 1) Upload to temporary guest autofill path (for reliability/audit/debug)
      const prepareUpload = httpsCallable(functions, 'getSignedUploadUrl');
      const { data: uploadData } = await prepareUpload({
        companyId,
        fileName: file.name,
        fileType: file.type,
        folder: 'autofill',
      });
      const storagePath = uploadData?.storagePath;
      if (!storagePath) {
        throw new Error('Could not reserve upload path.');
      }
      const uploadRef = ref(storage, storagePath);
      await uploadBytes(uploadRef, file, { contentType: file.type });
      setAutoFillStoragePath(storagePath);

      // 2) Send image to secure Groq parser callable (no API key in frontend)
      const imageDataUrl = await fileToDataUrl(file);
      const parseFn = httpsCallable(functions, 'parseCdlWithGroq', { timeout: 60000 });
      const { data } = await parseFn({
        companyId,
        imageDataUrl,
        storagePath,
      });
      const fields = data?.fields || {};
      const dobIso = parseIsoFromLooseDate(fields.dateOfBirth);
      const cdlExpIso = parseIsoFromLooseDate(fields.expirationDate);
      const addr = parseAddressPartsFromCdl(fields.fullAddress);

      onAutoFilled((prev) => ({
        ...prev,
        firstName: fields.firstName || prev.firstName || '',
        lastName: fields.lastName || prev.lastName || '',
        dob: dobIso || prev.dob || '',
        street: addr.street || prev.street || '',
        city: addr.city || prev.city || '',
        state: addr.state || prev.state || '',
        zip: addr.zip || prev.zip || '',
        cdlNumber: fields.cdlNumber || prev.cdlNumber || '',
        cdlExpiration: cdlExpIso || prev.cdlExpiration || '',
        // Best-effort: when address parsing yields a valid state, mirror to CDL state too.
        cdlState: addr.state || prev.cdlState || '',
      }));

      showSuccess('CDL auto-fill complete. Please review your information.');
    } catch (err) {
      console.error('[useCdlAutoFill] CDL auto-fill failed:', err);
      const msg = err?.message || 'Could not auto-fill from CDL. You can continue manually.';
      showError(msg);
      // Keep user on the choice screen when OCR fails so they don't feel
      // force-routed into the full manual wizard unexpectedly.
      onReturnToChooser();
    } finally {
      setIsParsingCdl(false);
    }
  };

  return {
    isParsingCdl,
    autoFillStoragePath,
    cdlInputRef,
    handleChooseAutoFill,
    handleCdlFileChange,
  };
}
