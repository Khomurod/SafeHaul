import React, { useId, useRef, useState, useEffect, useMemo } from 'react';
import { db, storage } from '@lib/firebase';
import { collection, addDoc, getDoc, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Upload, Trash2, FileText, Download, AlertTriangle } from 'lucide-react';
import { logActivity } from '@shared/utils/activityLogger';
import {
  Badge, Button, Card, FieldMessage, FormField, IconButton, Select, StatusMedallion,
} from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@shared/components/modals/Modal';
import {
  NoPreservedPdfError,
  downloadPreservedApplicationPdf,
} from '@features/applications/services/applicationPdfService';

/**
 * Driver Qualification file management for one application or lead.
 *
 * Migrated to the design system 2026-07-28. This was one of the four dossier tab
 * bodies deliberately left unmigrated by the 2026-07-27 dossier foundation slice
 * and recorded as residual debt since.
 *
 * Presentation only. Frozen and unchanged: the eleven `DQ_FILE_TYPES` and their
 * order (with `[0]` as the initial and post-upload reset value); the
 * `companies/{companyId}/{collectionName}/{applicationId}/dq_files` sub-collection
 * and its `orderBy('createdAt', 'desc')`; the eight `syncTargets` field→type
 * mappings and their expiration fields, which must stay in step with
 * `driverSync.js`; the de-duplication by `url`; the auto-sync payload including
 * `ownerUserIds`, `isSynced` and `sourceField`; the Storage path
 * `companies/{companyId}/applications/{applicationId}/dq_files/{type-with-non-alphanumerics-as-underscores}_{name}`
 * — which deliberately uses `applications` even for leads to satisfy the existing
 * Storage rules; the manual-upload document shape; both
 * `logActivity(..., 'dq_file_uploaded' | 'dq_file_deleted', ...)` calls and their
 * exact detail strings; the delete-from-Storage-then-Firestore order; the
 * expiration thresholds (`< 0` expired, `< 30` expiring) and their label text; the
 * 2-second upload-message reset; and every user-facing string.
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

const DQ_FILE_TYPES = [
  "Application for Employment",
  "Previous Employer Inquiry (3yr)",
  "MVR (Annual)",
  "Medical Card",
  "Road Test Certificate",
  "PSP Report",
  "Clearinghouse Report (Full)",
  "Clearinghouse Report (Annual)",
  "Certificate of Violations (Annual)",
  "Annual Review",
  "Other"
];

export function DQFileTab({ companyId, applicationId, collectionName = 'applications' }) {

  const [dqFiles, setDqFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [error, setError] = useState('');
  const [fileToUpload, setFileToUpload] = useState(null);
  const [selectedFileType, setSelectedFileType] = useState(DQ_FILE_TYPES[0]);
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

  const fileTypeFieldId = useId();
  const fileInputId = useId();
  // Replaces `document.getElementById('dq-file-input')`.
  const fileInputRef = useRef(null);

  // --- 1. Get the correct Firestore path ---
  const dqFilesCollectionRef = useMemo(() => {
    // Dynamic path: companies/{id}/applications OR leads/{appId}/dq_files
    const appRef = doc(db, "companies", companyId, collectionName, applicationId);
    return collection(appRef, "dq_files");
  }, [companyId, applicationId, collectionName]);

  // --- Helper: Get Expiration Status ---
  // The thresholds and labels are unchanged; only the colour decision moved from
  // a locally-picked palette trio to an approved semantic tone.
  const getExpirationStatus = (dateString) => {
    if (!dateString) return null;
    const today = new Date();
    const expDate = new Date(dateString);
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'EXPIRED', tone: 'danger' };
    if (diffDays < 30) return { label: `Expiring in ${diffDays} days`, tone: 'warning' };
    return { label: 'Active', tone: 'success' };
  };

  // --- 2. Fetch and Sync DQ files ---
  const fetchAndSyncFiles = async () => {
    setLoading(true);
    setError('');
    try {
      // A. Fetch Existing DQ Files
      const q = query(dqFilesCollectionRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const existingFiles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // B. Fetch Parent Application to Check for Uploads
      const appRef = doc(db, "companies", companyId, collectionName, applicationId);
      const appSnap = await getDoc(appRef);

      let newSyncs = 0;

      if (appSnap.exists()) {
        const appData = appSnap.data();

        // C. Define Sync Mapping with Expiration Fields
        // Must match the cloud function mappings in driverSync.js
        const syncTargets = [
          { field: 'cdl-front', type: 'CDL (Front)', expirationField: 'cdlExpiration' },
          { field: 'cdl-back', type: 'CDL (Back)', expirationField: 'cdlExpiration' },
          { field: 'medical-card-upload', type: 'Medical Card', expirationField: 'medCardExpiration' },
          { field: 'twic-card-upload', type: 'TWIC Card', expirationField: 'twicExpiration' },
          { field: 'mvr-upload', type: 'MVR (Annual)' },
          { field: 'mvr-consent-upload', type: 'MVR Consent' },
          { field: 'drug-test-consent-upload', type: 'Drug Test Consent' },
          { field: 'ssc-upload', type: 'SSN Card' }
        ];

        // D. Perform Sync
        for (const target of syncTargets) {
          const fileData = appData[target.field];
          // Check if file data exists and has a URL
          if (fileData && fileData.url) {
            // Check if already in DQ Files (avoid duplicates by URL)
            const alreadyExists = existingFiles.some(f => f.url === fileData.url);

            if (!alreadyExists) {
              const newFilePayload = {
                fileType: target.type,
                fileName: fileData.name || 'Auto-Synced File',
                url: fileData.url,
                storagePath: fileData.storagePath || '',
                createdAt: new Date(),
                applicantId: appData.applicantId || null,
                driverId: appData.driverId || null,
                userId: appData.userId || null,
                ownerUserIds: [appData.driverId || appData.userId || appData.applicantId || applicationId],
                isSynced: true,
                sourceField: target.field
              };

              // Add Expiration if available
              if (target.expirationField && appData[target.expirationField]) {
                newFilePayload.expirationDate = appData[target.expirationField];
              }

              // Create DQ File Entry
              await addDoc(dqFilesCollectionRef, newFilePayload);
              newSyncs++;
            }
          }
        }
      }

      // E. Update State
      if (newSyncs > 0) {
        const updatedQ = query(dqFilesCollectionRef, orderBy("createdAt", "desc"));
        const updatedSnap = await getDocs(updatedQ);
        setDqFiles(updatedSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } else {
        setDqFiles(existingFiles);
      }

    } catch (err) {
      console.error("Error fetching/syncing DQ files:", err);
      setError("Could not load DQ files. Check permissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAndSyncFiles();
  }, [dqFilesCollectionRef]);

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
      const storagePath = `companies/${companyId}/applications/${applicationId}/dq_files/${selectedFileType.replace(/[^a-zA-Z0-9]/g, '_')}_${fileToUpload.name}`;
      const storageRef = ref(storage, storagePath);

      // Upload
      await uploadBytes(storageRef, fileToUpload);
      const downloadURL = await getDownloadURL(storageRef);
      setUploadMessage('Saving to database...');

      // Create Firestore document in the sub-collection
      const appRef = doc(db, "companies", companyId, collectionName, applicationId);
      const appSnap = await getDoc(appRef);
      const appData = appSnap.exists() ? appSnap.data() : {};
      const newDoc = {
        fileType: selectedFileType,
        fileName: fileToUpload.name,
        url: downloadURL,
        storagePath: storagePath,
        applicantId: appData.applicantId || null,
        driverId: appData.driverId || null,
        userId: appData.userId || null,
        ownerUserIds: [appData.driverId || appData.userId || appData.applicantId || applicationId],
        createdAt: new Date()
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
      setSelectedFileType(DQ_FILE_TYPES[0]);
      if (fileInputRef.current) fileInputRef.current.value = null;

      // Assuming fetchDqFiles is meant to be fetchAndSyncFiles
      await fetchAndSyncFiles();
      setTimeout(() => setUploadMessage(''), 2000);

    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // --- 4. Handle File Delete ---
  // The blocking `window.confirm` guard now lives in `<DeleteFileDialog>`; the
  // Storage/Firestore/activity-log sequence below is unchanged.
  const confirmDelete = async (file) => {
    setPendingDelete(null);
    setLoading(true);
    setError('');

    try {
      // Delete from Storage
      const storageRef = ref(storage, file.storagePath);
      await deleteObject(storageRef);

      // Delete from Firestore
      const docRef = doc(dqFilesCollectionRef, file.id);
      await deleteDoc(docRef);

      // Log activity for the deletion
      await logActivity(
        companyId,
        collectionName,
        applicationId,
        'dq_file_deleted',
        `Deleted DQ file: ${file.fileType} - ${file.fileName}`,
        'user'
      );

      // Assuming fetchDqFiles is meant to be fetchAndSyncFiles
      await fetchAndSyncFiles();

    } catch (err) {
      console.error("Delete failed:", err);
      setError(`Delete failed: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <Stack gap="lg">
      <Card padding="lg">
        <h3 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-heading-sm font-bold text-ds-content">
          Add New DQ File
        </h3>
        <Stack gap="md">
          <FormField id={fileTypeFieldId} label="File Type">
            <Select
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
              disabled={isUploading}
            >
              {DQ_FILE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
          </FormField>

          <div className="ds-form-field">
            <label htmlFor={fileInputId} className="ds-label"><span>File</span></label>
            {/*
              Feature-owned exception: no approved file-input contract exists yet.
              The `file:` pseudo-element styling now uses `--ds-*` values.
            */}
            <input
              type="file"
              id={fileInputId}
              ref={fileInputRef}
              className="w-full text-ds-sm text-ds-content
                         file:mr-ds-4 file:rounded-ds-md file:border-0
                         file:bg-ds-status-info-bg file:px-ds-4 file:py-ds-2
                         file:text-ds-sm file:font-semibold file:text-ds-status-info-fg"
              onChange={(e) => setFileToUpload(e.target.files[0])}
              disabled={isUploading}
            />
          </div>

          <div className="flex flex-wrap items-center gap-ds-4">
            <Button
              variant="primary"
              onClick={handleUpload}
              disabled={isUploading || !fileToUpload}
              loading={isUploading}
            >
              {!isUploading && <Upload size={20} aria-hidden="true" />}
              {isUploading ? 'Uploading...' : 'Upload File'}
            </Button>
            {/* Always mounted so the live region can announce into it. */}
            <div role="status">
              {uploadMessage && <FieldMessage tone="success">{uploadMessage}</FieldMessage>}
            </div>
          </div>

          <div role="alert">
            {error && (
              <p className="flex items-center gap-ds-2 rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3 text-ds-sm text-ds-status-danger-fg">
                <AlertTriangle size={16} aria-hidden="true" className="shrink-0" /> {error}
              </p>
            )}
          </div>
        </Stack>
      </Card>

      <Card padding="lg">
        <h3 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-heading-sm font-bold text-ds-content">
          Current DQ Files
        </h3>
        <Stack gap="sm">
          {loading && (
            <p role="status" className="p-ds-4 text-center text-ds-sm text-ds-content-secondary">
              Loading DQ files...
            </p>
          )}
          {!loading && dqFiles.length === 0 && (
            <p className="p-ds-4 text-center text-ds-content-secondary">
              No DQ files have been uploaded for this driver.
            </p>
          )}
          {!loading && dqFiles.map(file => {
            const status = getExpirationStatus(file.expirationDate);
            return (
              <div
                key={file.id}
                className="flex items-center justify-between gap-ds-3 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3"
              >
                <div className="flex min-w-0 items-center gap-ds-3">
                  <FileText size={20} className="shrink-0 text-ds-content-link" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate text-ds-sm font-medium text-ds-content">{file.fileType}</p>
                    <div className="flex flex-wrap items-center gap-ds-2">
                      <p className="truncate text-ds-xs text-ds-content-secondary">{file.fileName}</p>
                      {status && (
                        <Badge tone={status.tone}>
                          {status.label} ({file.expirationDate})
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 gap-ds-2">
                  {file.requiresAuditedAccess ? (
                    /*
                      The preserved application original. It has no durable link
                      on purpose: it may carry the applicant's full Social
                      Security Number, so it is fetched through a callable that
                      authorizes the caller and writes an audit record first. An
                      `<a href>` here would be an unaudited way in.
                    */
                    <IconButton
                      label={`Download ${file.fileType}: ${file.fileName}`}
                      variant="ghost"
                      onClick={() => handleAuditedDownload(file)}
                    >
                      <Download size={18} aria-hidden="true" className="text-ds-status-info-fg" />
                    </IconButton>
                  ) : (
                    /*
                      Feature-owned exception: a real navigation to a signed Storage
                      URL, so it must stay an `<a>`. The design system has no
                      Link/ButtonLink primitive yet — the same exception already
                      recorded for the dossier's four styled `<a>` navigations.
                      It previously had `title` as its only name.
                    */
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Download ${file.fileType}: ${file.fileName}`}
                      className="flex h-9 w-9 items-center justify-center rounded-ds-md bg-ds-status-info-bg text-ds-status-info-fg transition-colors hover:bg-ds-surface-subtle focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                      <Download size={18} aria-hidden="true" />
                    </a>
                  )}
                  {/*
                    The preserved original carries no delete control. It is the
                    evidentiary record of what the applicant submitted, kept for
                    the three years 49 CFR 391.51 requires; deleting the
                    application removes it, and nothing else may.
                  */}
                  {!file.requiresAuditedAccess && (
                    <IconButton
                      label={`Delete ${file.fileType}: ${file.fileName}`}
                      variant="ghost"
                      onClick={() => setPendingDelete(file)}
                    >
                      <Trash2 size={18} aria-hidden="true" className="text-ds-status-danger-fg" />
                    </IconButton>
                  )}
                </div>
              </div>
            );
          })}
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

/**
 * Replaces the blocking `window.confirm` that guarded DQ file deletion. The
 * question is preserved verbatim.
 */
function DeleteFileDialog({ file, onCancel, onConfirm }) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Modal
      onClose={onCancel}
      labelledBy={titleId}
      describedBy={descriptionId}
      closeOnBackdrop={false}
      className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div className="p-ds-5 text-center">
        <StatusMedallion tone="danger" className="mx-auto mb-ds-3"><AlertTriangle /></StatusMedallion>
        <h2 id={titleId} className="text-ds-heading-sm font-bold text-ds-content">Delete this DQ file?</h2>
        <p id={descriptionId} className="mt-ds-3 break-words text-ds-sm text-ds-content-secondary">
          {`Are you sure you want to delete "${file.fileName}"?`}
        </p>
      </div>
      <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}>Delete file</Button>
      </div>
    </Modal>
  );
}
