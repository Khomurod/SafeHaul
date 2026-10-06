/**
 * CDL auto-fill workflow for the public application.
 *
 * One responsibility: turn a CDL photo into form-field values — upload the
 * image, run the secure server-side Groq parser (no API key in the frontend),
 * and hand back a formData updater with the parsed fields.
 *
 * The photo IS the application's CDL front. It goes to the `applications`
 * folder in the `{ name, storagePath }` shape `useGuestFileUpload` stores, so the
 * License step shows it attached and the driver never photographs the licence
 * twice. A company that hides the CDL upload gets no CDL photo: there the image
 * goes to the `autofill` folder as before and is not attached. Parsed values only
 * fill fields that are still empty: what the driver typed always wins.
 *
 * Navigation side effects stay with the caller:
 *  - `onAutoFilled(updater)` applies the updater and enters the wizard. It fires
 *    on success, and also when the photo uploaded but could not be read, so the
 *    driver goes on by hand with the photo already attached;
 *  - `onReturnToChooser()` fires when the picker is dismissed, the file is
 *    refused, the upload itself fails, or a photo that is not kept could not be
 *    read — nothing was kept, so the driver stays on the choice screen instead
 *    of being force-routed into the wizard.
 */
import { useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { functions, storage } from '@lib/firebase';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { parseAddressPartsFromCdl } from '@shared/utils/parseCdlAddress';
import { aiReadErrorMessage } from '@shared/utils/aiReadErrors';
import { toUsStateName } from '@shared/utils/usStates';
import { resolveApplicationGate } from '@/config/applicationGates';
import {
  AUTO_FILL_IMAGE_TYPES,
  parseIsoFromLooseDate,
  fileToDataUrl,
} from '../components/application/publicApplyHelpers';

export function useCdlAutoFill({ companyId, applicationConfig, onAutoFilled, onReturnToChooser }) {
  const { showSuccess, showError } = useToast();
  const [isParsingCdl, setIsParsingCdl] = useState(false);
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

    const keepPhoto = !resolveApplicationGate(applicationConfig, 'cdlUpload').hidden;
    // Set once a kept photo is in Storage; from then on it is never thrown away.
    let cdlFront = null;
    try {
      if (!companyId) {
        throw new Error('Company is missing. Please refresh and try again.');
      }

      setIsParsingCdl(true);

      // 1) Upload as the application's CDL front, where any guest upload goes.
      const prepareUpload = httpsCallable(functions, 'getSignedUploadUrl');
      const { data: uploadData } = await prepareUpload({
        companyId,
        fileName: file.name,
        fileType: file.type,
        folder: keepPhoto ? 'applications' : 'autofill',
      });
      const storagePath = uploadData?.storagePath;
      if (!storagePath) {
        throw new Error('Could not reserve upload path.');
      }
      const uploadRef = ref(storage, storagePath);
      await uploadBytes(uploadRef, file, { contentType: file.type });
      if (keepPhoto) cdlFront = { name: file.name, storagePath };

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
      // The licence prints a postal code ("TX"); both pickers it fills hold names
      // ("Texas"), and given a code they rendered "Alabama". One the list cannot
      // name is left for the driver rather than stored where no picker can show it.
      const stateName = toUsStateName(addr.state);

      onAutoFilled((prev) => ({
        ...prev,
        firstName: prev.firstName || fields.firstName || '',
        lastName: prev.lastName || fields.lastName || '',
        dob: prev.dob || dobIso || '',
        street: prev.street || addr.street || '',
        city: prev.city || addr.city || '',
        state: prev.state || stateName || '',
        zip: prev.zip || addr.zip || '',
        cdlNumber: prev.cdlNumber || fields.cdlNumber || '',
        cdlExpiration: prev.cdlExpiration || cdlExpIso || '',
        // Best-effort: when address parsing yields a valid state, mirror to CDL state too.
        cdlState: prev.cdlState || stateName || '',
        ...(cdlFront ? { 'cdl-front': prev['cdl-front'] || cdlFront } : {}),
      }));

      showSuccess('CDL auto-fill complete. Please review your information.');
    } catch (err) {
      console.error('[useCdlAutoFill] CDL auto-fill failed:', err);
      if (cdlFront) {
        // The photo is in Storage and is the CDL front either way, so the driver
        // goes on by hand with it attached instead of taking it again. Nothing
        // here says the licence was unreadable: the service may simply be down.
        showError('Auto-fill did not work this time. Your photo is attached; please fill in the form.');
        onAutoFilled((prev) => ({ ...prev, 'cdl-front': prev['cdl-front'] || cdlFront }));
        return;
      }
      showError(aiReadErrorMessage(err, 'Auto-fill did not work this time. You can continue manually.'));
      // Nothing was kept, so the driver stays on the choice screen rather than
      // being force-routed into the full manual wizard unexpectedly.
      onReturnToChooser();
    } finally {
      setIsParsingCdl(false);
    }
  };

  return {
    isParsingCdl,
    cdlInputRef,
    handleChooseAutoFill,
    handleCdlFileChange,
  };
}
