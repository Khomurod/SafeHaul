import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '@lib/firebase';
import { collection, addDoc, getDoc, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Loader2, Upload, Trash2, FileText, Download, AlertTriangle } from 'lucide-react';
import { Section } from '../application/ApplicationUI';
import { logActivity } from '@shared/utils/activityLogger';

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

  // --- 1. Get the correct Firestore path ---
  const dqFilesCollectionRef = useMemo(() => {
    // Dynamic path: companies/{id}/applications OR leads/{appId}/dq_files
    const appRef = doc(db, "companies", companyId, collectionName, applicationId);
    return collection(appRef, "dq_files");
  }, [companyId, applicationId, collectionName]);

  // --- Helper: Get Expiration Status ---
  const getExpirationStatus = (dateString) => {
    if (!dateString) return null;
    const today = new Date();
    const expDate = new Date(dateString);
    const diffTime = expDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return { label: 'EXPIRED', color: 'bg-red-100 text-red-800 border-red-200' };
    if (diffDays < 30) return { label: `Expiring in ${diffDays} days`, color: 'bg-yellow-100 text-yellow-800 border-yellow-200' };
    return { label: 'Active', color: 'bg-green-100 text-green-800 border-green-200' };
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
        const syncTargets = [
          { field: 'medical-card-upload', type: 'Medical Card', expirationField: 'medCardExpiration' }, // Fallback if added later
          { field: 'cdl-front', type: 'CDL (Front)', expirationField: 'cdlExpiration' },
          { field: 'cdl-back', type: 'CDL (Back)', expirationField: 'cdlExpiration' },
          { field: 'twic-card-upload', type: 'TWIC Card', expirationField: 'twicExpiration' },
          { field: 'mvr-upload', type: 'MVR (Annual)' }
        ];

        // D. Perform Sync
        for (const target of syncTargets) {
          const fileData = appData[target.field];
          // Check if file data exists and has a URL
          if (fileData && fileData.url) {
            // Check if already in DQ Files (avoid duplicates by URL)
            const alreadyExists = existingFiles.some(f => f.url === fileData.url);

            if (!alreadyExists) {
              console.log(`Syncing ${target.type}...`);

              const newFilePayload = {
                fileType: target.type,
                fileName: fileData.name || 'Auto-Synced File',
                url: fileData.url,
                storagePath: fileData.storagePath || '',
                createdAt: new Date(),
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
      const newDoc = {
        fileType: selectedFileType,
        fileName: fileToUpload.name,
        url: downloadURL,
        storagePath: storagePath,
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
      document.getElementById('dq-file-input').value = null;

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
  const handleDelete = async (file) => {
    if (!window.confirm(`Are you sure you want to delete "${file.fileName}"?`)) {
      return;
    }

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
    <div className="space-y-6">
      <Section title="Add New DQ File">
        <div className="space-y-4">
          <div>
            <label htmlFor="dq-file-type" className="block text-sm font-medium text-gray-700 mb-1">
              File Type
            </label>
            <select
              id="dq-file-type"
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              value={selectedFileType}
              onChange={(e) => setSelectedFileType(e.target.value)}
              disabled={isUploading}
            >
              {DQ_FILE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dq-file-input" className="block text-sm font-medium text-gray-700 mb-1">
              File
            </label>
            <input
              type="file"
              id="dq-file-input"
              className="w-full text-sm text-gray-700
                         file:mr-4 file:py-2 file:px-4
                         file:rounded-lg file:border-0
                         file:text-sm file:font-semibold
                         file:bg-blue-50 file:text-blue-700
                         hover:file:bg-blue-100"
              onChange={(e) => setFileToUpload(e.target.files[0])}
              disabled={isUploading}
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              className="w-full sm:w-auto py-2 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition duration-150 disabled:opacity-75"
              onClick={handleUpload}
              disabled={isUploading || !fileToUpload}
            >
              {isUploading ? <Loader2 className="animate-spin" /> : <Upload size={20} />}
              <span className="ml-2">{isUploading ? 'Uploading...' : 'Upload File'}</span>
            </button>
            {uploadMessage && <p className="text-sm text-green-600">{uploadMessage}</p>}
          </div>
          {error && <p className="text-sm text-red-600 p-3 bg-red-50 rounded-lg flex items-center gap-2"><AlertTriangle size={16} /> {error}</p>}
        </div>
      </Section>

      <Section title="Current DQ Files">
        <div className="space-y-3">
          {loading && (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="animate-spin text-gray-500" />
            </div>
          )}
          {!loading && dqFiles.length === 0 && (
            <p className="text-gray-500 italic text-center p-4">No DQ files have been uploaded for this driver.</p>
          )}
          {!loading && dqFiles.map(file => {
            const status = getExpirationStatus(file.expirationDate);
            return (
              <div key={file.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg hover:shadow-sm transition">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileText size={20} className="text-blue-600 shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-gray-900 truncate">{file.fileType}</p>
                    <div className="flex items-center gap-2">
                      <p className="text-xs text-gray-600 truncate" title={file.fileName}>{file.fileName}</p>
                      {status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${status.color}`}>
                          {status.label} ({file.expirationDate})
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-all"
                    title="Download File"
                  >
                    <Download size={18} />
                  </a>
                  <button
                    className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-all"
                    title="Delete File"
                    onClick={() => handleDelete(file)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}