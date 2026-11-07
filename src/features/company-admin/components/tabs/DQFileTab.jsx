import React, { useId, useRef, useState, useEffect, useMemo } from 'react';
import { db } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { collection, addDoc, deleteField, getDoc, getDocs, deleteDoc, doc, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Icon, Upload } from '@design-system/icons';
import { logActivity } from '@shared/utils/activityLogger';
import {
  Button, Card, FieldMessage, FileInput, FormField, Input, Notice, Select,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { DeleteFileDialog } from './DeleteFileDialog';
import { DQChecklist } from './DQChecklist';
import { DQFileRow } from './DQFileRow';
import {
  NoPreservedPdfError,
  downloadPreservedApplicationPdf,
} from '@features/applications/services/applicationPdfService';
import {
  BLOCKED_TAB_MESSAGE,
  openApplicationFile,
} from '@features/applications/services/openApplicationFile';
import { DATED_FILE_TYPES, DQ_FILE_TYPES } from '../../utils/dqFileTypes';
import { calendarDay } from '../../utils/dqExpiry';
import { fileDriverUploadsOnce } from './dqFileSync';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/**
 * Driver Qualification file management for one application or lead.
 *
 * Built on the design system's components and `--ds-*` tokens.
 *
 * Presentation only. Frozen and unchanged: the `DQ_FILE_TYPES` and their order
 * (`utils/dqFileTypes.js`; "CDL" joined them after "Medical Card"), none chosen
 * at first or after an upload (it defaulted to "Application for Employment",
 * which the server files itself, so nearly every upload began by changing it); the
 * `companies/{companyId}/{collectionName}/{applicationId}/dq_files` sub-collection
 * and its `orderBy('createdAt', 'desc')`; the Storage path
 * `companies/{companyId}/applications/{applicationId}/dq_files/{ms}_{type-with-non-alphanumerics-as-underscores}_{name}`
 * — which deliberately uses `applications` even for leads to satisfy the existing
 * Storage rules, and starts with the upload's time so a second file of one type
 * and one name does not replace the first; the manual-upload document shape; both
 * `logActivity(..., 'dq_file_uploaded' | 'dq_file_deleted', ...)` calls and their
 * exact detail strings; the delete-from-Storage-then-Firestore order for a file
 * the DQ tab uploaded; the expiration thresholds (`< 0` expired, `< 30` expiring,
 * now by the UTC day in `utils/dqExpiry.js`); the 2-second upload-message reset;
 * and every user-facing string but the dates' badges, which now say "Expired on
 * …", "Expires on …, in N days" or "Valid until …", and the two cards' headings,
 * "Files" and "Upload a file" (the tab's own name is its tab's and the header's).
 *
 * Above the list, "What's in the file" (`DQChecklist`) shows each item of the
 * file and whether it holds it, from the entries read and the record's employers
 * (`appData`, as the dossier read it). An item it lacks or holds expired opens
 * the upload form, below the list, with that item's type chosen; the employers
 * open the Previous Employment tab (`onOpenTab('pev')`, from the dossier). A
 * team upload of a CDL, medical card or
 * MVR may carry an optional valid-until date (`expirationDate`, `YYYY-MM-DD`),
 * and a record of those kinds or a TWIC card can have its date set or cleared
 * (`DQFileRow`), logged as `dq_file_updated`. The server keeps the record's
 * `dqExpiresNext` from these dates.
 *
 * A synced record (`isSynced`) files the application's own upload, and only the
 * server writes one (`functions/shared/dqUploads.js`): when the application
 * arrives or an upload changes, and when this tab first opens in a dossier
 * opening (`fileDriverUploadsOnce`; again after a failed filing), for any upload
 * no record holds. Deleting one leaves the file, and keeps the
 * record unlisted with `removedAt`, so it is not filed again; a new upload of
 * that type clears the mark. A driver's upload opens from a link signed when it
 * is pressed; the `url` it was copied with lived minutes.
 *
 * Defects fixed:
 *  1. **Blocking `window.confirm` on the destructive delete** → the shared
 *     accessible dialog, wording preserved verbatim.
 *  2. **Both per-row controls were named by `title` alone** — an icon-only
 *     download `<a>` (`title="Download File"`) and an icon-only delete `<button>`
 *     (`title="Delete File"`). A `title` is not a reliable accessible name and is
 *     unreachable by touch. Both now carry real names that say *which* file they
 *     act on, so a screen-reader user reading a list of eight files can tell the
 *     controls apart.
 *  3. **`document.getElementById('dq-file-input')` reached across the component
 *     boundary** to clear the input, and the hard-coded id would collide if two
 *     dossiers were ever mounted at once. It is now a ref with a generated id.
 *  4. **The upload outcome and the error were not announced** — success was green
 *     text with no role, and a failed upload or delete changed only silent red
 *     text. Both are live regions now.
 *  5. **The loading state was an unannounced bare spinner.**
 *  6. **`text-[10px]` on the expiration chip** — sub-12px functional text, and the
 *     chip's `bg-yellow-100 text-yellow-800` trio was an unapproved palette. It is
 *     now a `Badge` whose tone comes from the design system while the feature keeps
 *     the domain→tone decision.
 *  7. The local `Section` helper from `application/ApplicationUI` was a `Card`
 *     reimplementation (`bg-white p-6 rounded-lg shadow-sm border-gray-200`). It is
 *     replaced by the approved `Card`; `ApplicationUI.jsx` had no other consumer
 *     and is deleted with this change.
 *  8. Legacy palette throughout (blue-50/100/200/600/700, red-50/100/700/800,
 *     green-100/600/800, yellow-100/200/800, gray-*).
 *
 * Documented feature-owned exception: the file input keeps its native
 * `file:`-pseudo styling, now on `--ds-*` values. The design system still has no
 * approved file-input contract — the same recorded exception already covers the
 * public application's two upload compositions and the PEV result upload.
 */

export function DQFileTab({ companyId, applicationId, collectionName = 'applications', appData = null, onOpenTab = null }) {

  const [dqFiles, setDqFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  // Whether the entries were read at least once: the checklist waits for them.
  const [loaded, setLoaded] = useState(false);
  const [validUntil, setValidUntil] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [error, setError] = useState('');
  const [fileToUpload, setFileToUpload] = useState(null);
  const [selectedFileType, setSelectedFileType] = useState('');
  // Replaces the blocking `window.confirm` on delete.
  const [pendingDelete, setPendingDelete] = useState(null);

  /**
   * Fetch a preserved application original through the audited callable.
   *
   * Never an `<a href>`: this document may carry the applicant's full Social
   * Security Number, and the callable authorizes the caller and writes the audit
   * record BEFORE it issues a link. A direct bucket URL would be an access
   * nobody could account for afterwards.
   */
  const handleAuditedDownload = async (file) => {
    setError('');
    try {
      await downloadPreservedApplicationPdf({
        companyId,
        applicationId,
        snapshotId: file.snapshotId,
      });
    } catch (err) {
      setError(err instanceof NoPreservedPdfError
        ? err.message
        : (err.message || 'Could not open the application document. Please try again.'));
    }
  };

  /** A driver's upload, from a link signed now; see `openApplicationFile`. */
  const openDriverUpload = (file) => {
    setError('');
    const opened = openApplicationFile(file.storagePath);
    if (!opened) {
      setError(BLOCKED_TAB_MESSAGE);
      return;
    }
    opened.catch((err) => setError(err.message));
  };

  const fileTypeFieldId = useId();
  const validUntilFieldId = useId();
  const fileInputId = useId();
  // Replaces `document.getElementById('dq-file-input')`.
  const fileInputRef = useRef(null);
  const uploadFormRef = useRef(null);
  const validUntilRef = useRef(null);
  // Where focus goes once the chosen type has rendered its fields.
  const [focusAfterChoice, setFocusAfterChoice] = useState(null);

  /**
   * A checklist item's Upload: the form, with the item's type chosen. Focus
   * goes to the first field still to fill: a dated type's date, so the forward
   * path meets it before the file, else the file picker.
   */
  const chooseUploadType = (type) => {
    setSelectedFileType(type);
    setFocusAfterChoice(DATED_FILE_TYPES.includes(type) ? 'date' : 'file');
    uploadFormRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

  useEffect(() => {
    if (!focusAfterChoice) return;
    const target = focusAfterChoice === 'date' ? validUntilRef.current : fileInputRef.current;
    target?.focus({ preventScroll: true });
    setFocusAfterChoice(null);
  }, [focusAfterChoice]);

  // --- 1. Get the correct Firestore path ---
  const dqFilesCollectionRef = useMemo(() => {
    // Dynamic path: companies/{id}/applications OR leads/{appId}/dq_files
    const appRef = doc(db, "companies", companyId, collectionName, applicationId);
    return collection(appRef, "dq_files");
  }, [companyId, applicationId, collectionName]);

  // --- 2. Read the DQ files ---
  // Only the latest read shows: the one after the server files uploads can
  // overtake the first. A `quiet` read keeps the list on screen, so a row keeps
  // its focus while its date is saved.
  const readCount = useRef(0);
  const loadFiles = async ({ quiet = false } = {}) => {
    const read = ++readCount.current;
    if (!quiet) setLoading(true);
    setError('');
    try {
      const snapshot = await getDocs(query(dqFilesCollectionRef, orderBy("createdAt", "desc")));
      if (read === readCount.current) {
        setDqFiles(snapshot.docs.map((file) => ({ id: file.id, ...file.data() })));
        setLoaded(true);
      }
    } catch (err) {
      console.error("Error fetching DQ files:", err);
      if (read === readCount.current) setError("Could not load DQ files. Check permissions.");
    } finally {
      if (read === readCount.current) setLoading(false);
    }
  };

  // The list shows at once; the server files the uploads no record holds yet,
  // once a record while the dossier is open, and the list is read again when it
  // filed any.
  useEffect(() => {
    let current = true;
    // Another record's entries are not this one's checklist.
    setLoaded(false);
    loadFiles();
    fileDriverUploadsOnce({ companyId, collectionName, applicationId }).then(
      (filed) => { if (current && filed > 0) loadFiles(); },
      (err) => {
        console.error("Could not file the driver's uploads:", err);
        if (current) setError("Some of the driver's uploads could not be added here. Open this tab again to retry.");
      },
    );
    return () => { current = false; };
  }, [dqFilesCollectionRef]);

  // The upload message's reset, which goes with the tab.
  const messageTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(messageTimerRef.current), []);

  // --- 3. Handle File Upload ---
  const handleUpload = async () => {
    if (!fileToUpload || !selectedFileType) {
      setError("Please select a file and a file type.");
      return;
    }

    setIsUploading(true);
    setUploadMessage('Uploading file...');
    setError('');

    try {
      // NOTE: We use 'applications' in the storage path even for leads to satisfy existing Storage Rules
      // Storage Structure: companies/{companyId}/applications/{applicationId}/dq_files/...
      const storagePath = `companies/${companyId}/applications/${applicationId}/dq_files/${Date.now()}_${selectedFileType.replace(/[^a-zA-Z0-9]/g, '_')}_${fileToUpload.name}`;
      const storageRef = ref(storage, storagePath);

      // Upload
      await uploadBytes(storageRef, fileToUpload);
      const downloadURL = await getDownloadURL(storageRef);
      setUploadMessage('Saving to database...');

      // Create Firestore document in the sub-collection
      const appRef = doc(db, "companies", companyId, collectionName, applicationId);
      const appSnap = await getDoc(appRef);
      const owner = appSnap.exists() ? appSnap.data() : {};
      const expirationDate = DATED_FILE_TYPES.includes(selectedFileType) ? calendarDay(validUntil) : null;
      const newDoc = {
        fileType: selectedFileType,
        fileName: fileToUpload.name,
        url: downloadURL,
        storagePath: storagePath,
        applicantId: owner.applicantId || null,
        driverId: owner.driverId || null,
        userId: owner.userId || null,
        ownerUserIds: [owner.driverId || owner.userId || owner.applicantId || applicationId],
        createdAt: new Date(),
        // Only when one was given: the date printed on a CDL, medical card or MVR.
        ...(expirationDate ? { expirationDate } : {}),
      };

      await addDoc(dqFilesCollectionRef, newDoc);

      // Log activity for the upload
      await logActivity(
        companyId,
        collectionName,
        applicationId,
        'dq_file_uploaded',
        `Uploaded DQ file: ${selectedFileType} - ${fileToUpload.name}`,
        'user'
      );

      setUploadMessage('Upload Complete!');
      setFileToUpload(null);
      setSelectedFileType('');
      setValidUntil('');
      if (fileInputRef.current) fileInputRef.current.value = null;

      await loadFiles();
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(() => setUploadMessage(''), 2000);

    } catch (err) {
      console.error("Upload failed:", err);
      setError(plainErrorMessage(err, 'The file could not be uploaded.'));
    } finally {
      setIsUploading(false);
    }
  };

  // --- 4. Handle File Delete ---
  // The blocking `window.confirm` guard now lives in `<DeleteFileDialog>`.
  const confirmDelete = async (file) => {
    setPendingDelete(null);
    setLoading(true);
    setError('');

    try {
      const docRef = doc(dqFilesCollectionRef, file.id);
      if (file.isSynced) {
        // The application's own upload: the file stays, and so does the record,
        // marked removed, so that the server does not file the upload again.
        await updateDoc(docRef, { removedAt: serverTimestamp() });
      } else {
        // Delete from Storage
        const storageRef = ref(storage, file.storagePath);
        await deleteObject(storageRef);

        // Delete from Firestore
        await deleteDoc(docRef);
      }

      // Log activity for the deletion
      await logActivity(
        companyId,
        collectionName,
        applicationId,
        'dq_file_deleted',
        `Deleted DQ file: ${file.fileType} - ${file.fileName}`,
        'user'
      );

      await loadFiles();

    } catch (err) {
      console.error("Delete failed:", err);
      setError(plainErrorMessage(err, 'The file could not be deleted.'));
      setLoading(false);
    }
  };

  // --- 5. Set or clear a record's valid-until date ---
  // Throws for `DQFileRow`'s editor to show; the record's own date, never the application's.
  const saveExpiration = async (file, value) => {
    const day = calendarDay(value);
    if (value && !day) throw new Error('Enter a date, or leave it empty to clear it.');
    await updateDoc(doc(dqFilesCollectionRef, file.id), { expirationDate: day || deleteField() });
    await logActivity(
      companyId,
      collectionName,
      applicationId,
      'dq_file_updated',
      day
        ? `Set the valid-until date of DQ file: ${file.fileType} - ${file.fileName} to ${day}`
        : `Cleared the valid-until date of DQ file: ${file.fileType} - ${file.fileName}`,
      'user'
    );
    await loadFiles({ quiet: true });
  };

  // A synced record marked removed is kept for the server's matching, never shown.
  const shownFiles = dqFiles.filter((file) => !file.removedAt);

  return (
    <Stack gap="lg">
      {loaded && (
        <DQChecklist
          files={shownFiles}
          record={appData}
          onUpload={chooseUploadType}
          onOpenPev={onOpenTab ? () => onOpenTab('pev') : null}
          disabled={isUploading}
        />
      )}

      <Card padding="lg">
        <h3 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-heading-sm font-bold text-ds-content">
          Files
        </h3>
        <Stack gap="sm">
          {loading && (
            <p role="status" className="p-ds-4 text-center text-ds-sm text-ds-content-secondary">
              Loading DQ files...
            </p>
          )}
          {!loading && shownFiles.length === 0 && (
            <p className="p-ds-4 text-center text-ds-content-secondary">
              No DQ files have been uploaded for this driver.
            </p>
          )}
          {!loading && shownFiles.map(file => (
            <DQFileRow
              key={file.id}
              file={file}
              companyId={companyId}
              applicationId={applicationId}
              onAuditedDownload={handleAuditedDownload}
              onOpenDriverUpload={openDriverUpload}
              onDelete={setPendingDelete}
              onSaveExpiration={saveExpiration}
            />
          ))}
        </Stack>
      </Card>

      <Card ref={uploadFormRef} padding="lg">
        <h3 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-heading-sm font-bold text-ds-content">
          Upload a file
        </h3>
        <Stack gap="md">
          <FormField id={fileTypeFieldId} label="File Type">
            <Select
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
              disabled={isUploading}
            >
              <option value="">Choose a type</option>
              {DQ_FILE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
          </FormField>

          {DATED_FILE_TYPES.includes(selectedFileType) && (
            <FormField id={validUntilFieldId} label="Valid until (optional)" description="The date printed on the document, if it has one.">
              <Input
                ref={validUntilRef}
                type="date"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                disabled={isUploading}
              />
            </FormField>
          )}

          {/*
            `FileInput`: the picker's keyboard path and accessible name are the
            primitive's; which file is selected and what happens to it stay
            here.
          */}
          <FileInput
            id={fileInputId}
            ref={fileInputRef}
            label="File"
            buttonLabel={fileToUpload ? fileToUpload.name : 'Choose a file'}
            onChange={(e) => setFileToUpload(e.target.files[0])}
            disabled={isUploading}
          />

          <div className="flex flex-wrap items-center gap-ds-4">
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={isUploading || !fileToUpload || !selectedFileType}
              loading={isUploading}
            >
              {!isUploading && <Icon icon={Upload} size="xl" />}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </Button>
            {/* Always mounted so the live region can announce into it. */}
            <div role="status">
              {uploadMessage && <FieldMessage tone="success">{uploadMessage}</FieldMessage>}
            </div>
          </div>

          {/* The live region is this WRAPPER, and it stays. It is mounted
              whether or not there is an error, which is the whole point — a live
              region added to the DOM at the same moment as its content is not
              reliably announced. So the `Notice` inside takes `announce="off"`:
              moving the role onto it would look like a faithful migration and
              would quietly stop the announcement. */}
          <div role="alert">
            {error && (
              <Notice tone="danger" size="sm">{error}</Notice>
            )}
          </div>
        </Stack>
      </Card>

      {pendingDelete && (
        <DeleteFileDialog
          file={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => confirmDelete(pendingDelete)}
        />
      )}
    </Stack>
  );
}
