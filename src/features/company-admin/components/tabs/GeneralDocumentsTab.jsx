import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '@lib/firebase';
import { collection, addDoc, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { Loader2, Upload, Trash2, FileText, Download, AlertTriangle, Shield } from 'lucide-react';
import { Section } from '../application/ApplicationUI';
import { getFieldValue } from '@shared/utils/helpers';

const APP_FILE_KEYS = [
  { key: 'cdl-front', label: 'CDL (Front)' },
  { key: 'cdl-back', label: 'CDL (Back)' },
  { key: 'medical-card-upload', label: 'Medical Card' },
  { key: 'twic-card-upload', label: 'TWIC Card' },
  { key: 'mvr-consent-upload', label: 'MVR Consent Form' },
  { key: 'drug-test-consent-upload', label: 'Drug Test Consent' },
];

export function GeneralDocumentsTab({
  companyId,
  applicationId,
  appData,
  collectionName = 'applications' // Default to 'applications'
}) {
  const [generalDocs, setGeneralDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState('');
  const [error, setError] = useState('');
  const [fileToUpload, setFileToUpload] = useState(null);
  const [fileDescription, setFileDescription] = useState('');

  // --- 1. Get the correct Firestore path ---
  const generalDocsCollectionRef = useMemo(() => {
    // Dynamic path: companies/{id}/applications OR leads/{appId}/general_documents
    const appRef = doc(db, "companies", companyId, collectionName, applicationId);
    return collection(appRef, "general_documents");
  }, [companyId, applicationId, collectionName]);

  // --- 2. Function to fetch all general documents ---
  const fetchGeneralDocs = async () => {
    setLoading(true);
    setError('');
    try {
      const q = query(generalDocsCollectionRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const files = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        isReadonly: false,
        source: 'Uploaded'
      }));
      setGeneralDocs(files);
    } catch (err) {
      console.error("Error fetching general documents:", err);
      setError("Could not load documents. Check permissions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGeneralDocs();
  }, [generalDocsCollectionRef]);

  // --- 3. Merge with Application Files (ReadOnly) ---
  const applicationFiles = useMemo(() => {
    if (!appData) return [];

    return APP_FILE_KEYS.map(fileKey => {
      const fileData = appData[fileKey.key];
      if (!fileData || !fileData.url) return null;

      return {
        id: fileKey.key,
        description: fileKey.label,
        fileName: fileData.name,
        url: fileData.url,
        storagePath: fileData.storagePath,
        isReadonly: true,
        source: 'Application'
      };
    }).filter(file => file !== null);
  }, [appData]);

  // --- 4. Combine lists ---
  const combinedDocs = useMemo(() => {
    const formattedAppFiles = applicationFiles.map(file => ({
      ...file,
      createdAt: { seconds: 0 } // Oldest
    }));

    const allFiles = [...generalDocs, ...formattedAppFiles];

    allFiles.sort((a, b) => {
      const aDate = a.createdAt?.seconds || 0;
      const bDate = b.createdAt?.seconds || 0;
      return bDate - aDate; // Newest first
    });

    return allFiles;
  }, [applicationFiles, generalDocs]);

  // --- 5. Handle File Upload ---
  const handleUpload = async () => {
    if (!fileToUpload) {
      setError("Please select a file to upload.");
      return;
    }

    setIsUploading(true);
    setUploadMessage('Uploading file...');
    setError('');

    try {
      // Note: We keep 'applications' in the storage path to match Security Rules
      // Structure: companies/{companyId}/applications/{applicationId}/general_documents/...
      const storagePath = `companies/${companyId}/applications/${applicationId}/general_documents/${Date.now()}_${fileToUpload.name}`;
      const storageRef = ref(storage, storagePath);

      await uploadBytes(storageRef, fileToUpload);
      const downloadURL = await getDownloadURL(storageRef);
      setUploadMessage('Saving to database...');

      const newDoc = {
        description: fileDescription || 'No description',
        fileName: fileToUpload.name,
        url: downloadURL,
        storagePath: storagePath,
        createdAt: new Date()
      };

      await addDoc(generalDocsCollectionRef, newDoc);

      setUploadMessage('Upload Complete!');
      setFileToUpload(null);
      setFileDescription('');
      document.getElementById('general-file-input').value = null;

      await fetchGeneralDocs();
      setTimeout(() => setUploadMessage(''), 2000);

    } catch (err) {
      console.error("Upload failed:", err);
      setError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  // --- 6. Handle File Delete ---
  const handleDelete = async (file) => {
    if (!window.confirm(`Are you sure you want to delete "${file.fileName}"?`)) {
      return;
    }

    setLoading(true);
    setError('');

    try {
      const storageRef = ref(storage, file.storagePath);
      await deleteObject(storageRef);

      const docRef = doc(generalDocsCollectionRef, file.id);
      await deleteDoc(docRef);

      await fetchGeneralDocs();

    } catch (err) {
      console.error("Delete failed:", err);
      setError(`Delete failed: ${err.message}`);
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Section title="Upload a New Document">
        <div className="space-y-4">

          <div>
            <label htmlFor="file-description" className="block text-sm font-medium text-gray-700 mb-1">
              Description (Optional)
            </label>
            <input
              type="text"
              id="file-description"
              className="w-full p-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="E.g., Incident Report, Updated Insurance..."
              value={fileDescription}
              onChange={(e) => setFileDescription(e.target.value)}
              disabled={isUploading}
            />
          </div>

          <div>
            <label htmlFor="general-file-input" className="block text-sm font-medium text-gray-700 mb-1">
              File
            </label>
            <input
              type="file"
              id="general-file-input"
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

      <Section title="All Documents">
        <div className="space-y-3">
          {loading && (
            <div className="flex justify-center items-center p-4">
              <Loader2 className="animate-spin text-gray-500" />
            </div>
          )}
          {!loading && combinedDocs.length === 0 && (
            <p className="text-gray-500 italic text-center p-4">No documents have been uploaded for this driver.</p>
          )}
          {!loading && combinedDocs.map(file => (
            <div key={file.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-3 overflow-hidden">
                {file.isReadonly ? (
                  <Shield size={20} className="text-green-600 shrink-0" />
                ) : (
                  <FileText size={20} className="text-gray-500 shrink-0" />
                )}
                <div className="overflow-hidden">
                  <p className="text-sm font-medium text-gray-900 truncate" title={getFieldValue(file.description)}>
                    {getFieldValue(file.description)}
                  </p>
                  <p className="text-xs text-gray-600 truncate" title={file.fileName}>{file.fileName}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0 items-center">
                <span
                  className={`px-2 py-0.5 text-xs font-semibold rounded-full
                    ${file.isReadonly
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                    }
                  `}
                >
                  {file.source}
                </span>
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-all"
                  title="Download File"
                >
                  <Download size={18} />
                </a>
                {!file.isReadonly && (
                  <button
                    className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-all"
                    title="Delete File"
                    onClick={() => handleDelete(file)}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}