import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { db, functions } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { getCompanyProfile } from '@features/companies';
import { useCompanyTeam } from '@shared/hooks/useCompanyTeam';

const simpleRetry = async (fn, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

export function useAppFetch(companyId, applicationId) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [appData, setAppData] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [collectionName, setCollectionName] = useState('applications');
  const [fileUrls, setFileUrls] = useState({});
  // True while the record shows and its files are still being signed.
  const [filesPending, setFilesPending] = useState(false);
  const [currentStatus, setCurrentStatus] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  // The Assign To picker's team, each member keyed by the uid it saves.
  const { team: teamMembers } = useCompanyTeam(companyId, companyProfile);

  // A load for a record the dossier no longer shows changes nothing.
  const loadVersionRef = useRef(0);

  const loadApplication = useCallback(async () => {
    if (!companyId || !applicationId) return;
    const version = ++loadVersionRef.current;
    const current = () => version === loadVersionRef.current;
    setLoading(true);
    setError('');
    setFilesPending(false);

    try {
      // The company profile and the record at the same time: neither needs
      // the other. getCompanyProfile answers null rather than throw.
      let coll = 'applications';
      let docRef = doc(db, "companies", companyId, coll, applicationId);
      const [companyProf, firstSnap] = await Promise.all([
        getCompanyProfile(companyId),
        simpleRetry(() => getDoc(docRef)),
      ]);
      if (!current()) return;
      setCompanyProfile(companyProf);

      let docSnap = firstSnap;
      if (!docSnap.exists()) {
        coll = 'leads';
        docRef = doc(db, "companies", companyId, coll, applicationId);
        docSnap = await simpleRetry(() => getDoc(docRef));
        if (!current()) return;
      }

      if (docSnap.exists()) {
        setCollectionName(coll);
        const data = docSnap.data();
        setAppData(data);
        setCurrentStatus(data.status || 'New Application');
        setAssignedTo(data.assignedTo || '');

        const getUrl = async (fileData) => {
          if (!fileData) return null;
          try {
            if (fileData.storagePath) {
              // Driver-uploaded application files (CDL/medical card etc.) live under
              // guest_uploads. Their persisted `url` is a 15-min signed URL that has
              // expired by dossier-view time, and the client Storage SDK read is gated
              // by the narrow companyTeamIds claim (no super-admin bypass). Re-sign
              // server-side FIRST via the callable (RBAC'd by roles[companyId]/super_admin),
              // then fall back to the client SDK / stored url only if that fails.
              if (fileData.storagePath.includes('guest_uploads')) {
                try {
                  const resign = httpsCallable(functions, 'getSignedApplicationFileUrl');
                  const res = await resign({ storagePath: fileData.storagePath });
                  if (res?.data?.url) return res.data.url;
                } catch (resignErr) {
                  console.warn(`[useAppFetch] Server re-sign failed for ${fileData.storagePath}. Falling back to client SDK.`, resignErr.message);
                }
              }
              const fileRef = ref(storage, fileData.storagePath);
              try {
                return await getDownloadURL(fileRef);
              } catch (downloadErr) {
                // FALLBACK: If the file was uploaded via signed URL without a Firebase token,
                // getDownloadURL will fail. However, if the user has read access via security rules,
                // getBlob() will still work.
                console.warn(`[useAppFetch] getDownloadURL failed for ${fileData.storagePath}. Attempting getBlob fallback.`, downloadErr.message);
                try {
                  const { getBlob } = await import('firebase/storage');
                  const blob = await getBlob(fileRef);
                  return URL.createObjectURL(blob);
                } catch (blobErr) {
                  console.error(`[useAppFetch] getBlob fallback failed for ${fileData.storagePath}.`, blobErr.message);
                  return fileData.url || null;
                }
              }
            }
            return fileData.url || null;
          } catch (e) {
            console.error(`[useAppFetch] Unhandled error getting URL:`, e.message);
            return null;
          }
        };

        // The record shows now; its files are signed behind it (one callable
        // each), and the tabs that draw them wait on `filesPending`.
        setFileUrls({});
        setFilesPending(true);
        setLoading(false);

        const [cdl, cdlBack, ssc, medical, twic, mvrConsent, drugTestConsent, mvr] = await Promise.all([
          getUrl(data['cdl-front']), getUrl(data['cdl-back']), getUrl(data['ssc-upload']),
          getUrl(data['medical-card-upload']), getUrl(data['twic-card-upload']),
          getUrl(data['mvr-consent-upload']), getUrl(data['drug-test-consent-upload']),
          getUrl(data['mvr-upload'])
        ]);
        if (!current()) return;

        setFileUrls({
          'cdl-front': cdl,
          'cdl-back': cdlBack,
          'ssc-upload': ssc,
          'medical-card-upload': medical,
          'twic-card-upload': twic,
          'mvr-consent-upload': mvrConsent,
          'drug-test-consent-upload': drugTestConsent,
          'mvr-upload': mvr
        });
        setFilesPending(false);

      } else {
        setError(`Could not find record (ID: ${applicationId}).`);
      }
    } catch (err) {
      if (!current()) return;
      console.error("Error fetching document:", err);
      setError("Error: Could not load details.");
    } finally {
      if (current()) setLoading(false);
    }
  }, [companyId, applicationId]);

  useEffect(() => {
    loadApplication();
  }, [loadApplication]);

  return {
    loading,
    error,
    appData,
    setAppData,
    collectionName,
    fileUrls,
    filesPending,
    teamMembers,
    currentStatus,
    setCurrentStatus,
    assignedTo,
    setAssignedTo,
  };
}
