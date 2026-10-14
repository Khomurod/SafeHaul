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
 * is read and never uploaded, as no one would ever open it. Parsed values only
 * fill fields that are still empty: what the driver typed always wins.
 *
 * The photo is sent and read side by side: the reader takes the image itself,
 * so it never waits for Storage. The upload is `transferGuestUpload`'s, which
 * ends one that moves no bytes for 45 seconds, and `cancelCdlAutoFill` (the
 * reading screen's Cancel) stops it and drops whatever either brings back.
 *
 * Navigation side effects stay with the caller:
 *  - `onAutoFilled(updater)` applies the updater and enters the wizard. It fires
 *    when the licence was read, with the photo attached if it was sent, and
 *    when only the photo was sent, so the driver goes on by hand with it;
 *  - `onReturnToChooser()` fires when the picker is dismissed, the file is
 *    refused, the auto-fill is cancelled, or nothing was read and nothing kept,
 *    so the driver stays on the choice screen instead of being force-routed
 *    into the wizard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
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
import { shrinkPhoto } from './guestUploadImage';
import { transferGuestUpload } from './guestUploadTransfer';

/** Reserves a path for the photo as the application's CDL front and sends it there. */
async function sendCdlFront(companyId, file, signal) {
  const prepareUpload = httpsCallable(functions, 'getSignedUploadUrl');
  const { data: uploadData } = await prepareUpload({
    companyId,
    fileName: file.name,
    fileType: file.type,
    folder: 'applications',
  });
  const storagePath = uploadData?.storagePath;
  if (!storagePath) {
    throw new Error('Could not reserve upload path.');
  }
  await transferGuestUpload(storagePath, file, { contentType: file.type, signal });
  return { name: file.name, storagePath };
}

/** The licence's fields, read by the secure server-side parser (no API key in the frontend). */
async function readCdl(companyId, file) {
  const imageDataUrl = await fileToDataUrl(file);
  const parseFn = httpsCallable(functions, 'parseCdlWithGroq', { timeout: 60000 });
  const { data } = await parseFn({ companyId, imageDataUrl });
  return data?.fields || {};
}

export function useCdlAutoFill({ companyId, applicationConfig, onAutoFilled, onReturnToChooser }) {
  const { showSuccess, showError } = useToast();
  const [isParsingCdl, setIsParsingCdl] = useState(false);
  const cdlInputRef = useRef(null);
  // The auto-fill on its way, by its upload's controller. Cancel, a later pick
  // or leaving the page clears it, and a result whose run is not this one is dropped.
  const runRef = useRef(null);

  const dropRun = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    run?.abort();
    return run;
  }, []);

  useEffect(() => dropRun, [dropRun]);

  const cancelCdlAutoFill = () => {
    if (!dropRun()) return;
    setIsParsingCdl(false);
    onReturnToChooser();
  };

  const handleChooseAutoFill = () => {
    // Keep the user on the choice screen until a file is actually selected.
    // This prevents an accidental fallback into the manual wizard when the
    // picker is dismissed or blocked by the browser.
    cdlInputRef.current?.click();
  };

  const handleCdlFileChange = async (event) => {
    const picked = event.target.files?.[0];
    event.target.value = '';

    if (!picked) {
      // User closed chooser without selecting a file -> return to first choice screen.
      onReturnToChooser();
      return;
    }

    if (!AUTO_FILL_IMAGE_TYPES.has(picked.type)) {
      showError('Please upload a JPG, PNG, or WEBP image for CDL auto-fill.');
      onReturnToChooser();
      return;
    }
    // A phone camera's photo is often over the limit below; made smaller, it
    // reads as well and is sent and read faster.
    const file = await shrinkPhoto(picked);
    if (file.size > 8 * 1024 * 1024) {
      showError('CDL image is too large. Please use an image under 8MB.');
      onReturnToChooser();
      return;
    }

    if (!companyId) {
      showError('Company is missing. Please refresh and try again.');
      onReturnToChooser();
      return;
    }

    // A photo the company does not ask for is only read, never stored.
    const keepPhoto = !resolveApplicationGate(applicationConfig, 'cdlUpload').hidden;
    dropRun();
    const run = new AbortController();
    runRef.current = run;
    setIsParsingCdl(true);
    const [sent, read] = await Promise.allSettled([
      keepPhoto ? sendCdlFront(companyId, file, run.signal) : Promise.resolve(null),
      readCdl(companyId, file),
    ]);
    if (runRef.current !== run) return;
    runRef.current = null;
    setIsParsingCdl(false);

    // Once in Storage the photo is the CDL front, and it is never thrown away.
    const cdlFront = sent.status === 'fulfilled' ? sent.value : null;
    if (sent.status === 'rejected') console.error('[useCdlAutoFill] CDL photo upload failed:', sent.reason);
    const attachFront = (prev) => (cdlFront ? { 'cdl-front': prev['cdl-front'] || cdlFront } : {});

    if (read.status === 'fulfilled') {
      const fields = read.value;
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
        ...attachFront(prev),
      }));

      if (keepPhoto && !cdlFront) {
        showError('Your details were filled in, but the photo was not saved. Please add it again on the licence step.');
      } else {
        showSuccess('CDL auto-fill complete. Please review your information.');
      }
      return;
    }

    console.error('[useCdlAutoFill] CDL auto-fill failed:', read.reason);
    if (cdlFront) {
      // The photo is in Storage and is the CDL front either way, so the driver
      // goes on by hand with it attached instead of taking it again. Nothing
      // here says the licence was unreadable: the service may simply be down.
      showError('Auto-fill did not work this time. Your photo is attached; please fill in the form.');
      onAutoFilled((prev) => ({ ...prev, ...attachFront(prev) }));
      return;
    }
    showError(aiReadErrorMessage(read.reason, 'Auto-fill did not work this time. You can continue manually.'));
    // Nothing was kept, so the driver stays on the choice screen rather than
    // being force-routed into the full manual wizard unexpectedly.
    onReturnToChooser();
  };

  return {
    isParsingCdl,
    cancelCdlAutoFill,
    cdlInputRef,
    handleChooseAutoFill,
    handleCdlFileChange,
  };
}
