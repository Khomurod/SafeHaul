import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { db } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { getCompanyProfile } from '@features/companies';
import { reusableApplicationFileUrls } from '@features/applications/services/applicationFileLink';
import { useCompanyTeam } from '@shared/hooks/useCompanyTeam';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { e2eLoadedDossierRecord } from './e2eDossierFixture';

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

/** The driver uploads the dossier shows, signed when the record opens. */
const FILE_FIELDS = [
  'cdl-front', 'cdl-back', 'ssc-upload', 'medical-card-upload', 'twic-card-upload',
  'mvr-consent-upload', 'drug-test-consent-upload', 'mvr-upload',
];

/**
 * Where the record is looked for, in order. An opener that knows the record's
 * collection names it (`collectionHint`: a list, a bell notice, the linked lead
 * or application), so a lead is one read; the other collection is still looked
 * in when the record is not there. With no hint, or an unknown one, applications
 * first, then leads.
 */
function lookupOrder(collectionHint) {
  return collectionHint === 'leads' ? ['leads', 'applications'] : ['applications', 'leads'];
}

export function useAppFetch(companyId, applicationId, collectionHint) {
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
  // The Assigned to picker's team, each member keyed by the uid it saves.
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

    // `?e2eDossier=loaded` (E2E test mode only, never in a production build): a
    // made-up record (`e2eDossierFixture.js`) and no read, as E2E mode cannot
    // reach Firestore. Written out here, not in a helper, so a production build
    // drops the branch and the record with it.
    if (isE2ETestMode && !import.meta.env.PROD && getE2EQueryParam('e2eDossier', '') === 'loaded') {
      const data = e2eLoadedDossierRecord();
      setCollectionName('applications');
      setAppData(data);
      setCurrentStatus(data.status);
      setAssignedTo(data.assignedTo);
      setFileUrls({});
      setLoading(false);
      return;
    }

    try {
      // The company profile and the record at the same time: neither needs
      // the other. getCompanyProfile answers null rather than throw.
      const [firstColl, otherColl] = lookupOrder(collectionHint);
      let coll = firstColl;
      let docRef = doc(db, "companies", companyId, coll, applicationId);
      const [companyProf, firstSnap] = await Promise.all([
        getCompanyProfile(companyId),
        simpleRetry(() => getDoc(docRef)),
      ]);
      if (!current()) return;
      setCompanyProfile(companyProf);

      let docSnap = firstSnap;
      if (!docSnap.exists()) {
        coll = otherColl;
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

        // Its driver uploads are signed together, in one call, by the path each
        // is stored at (`reusableApplicationFileUrls`).
        const serverLinks = reusableApplicationFileUrls(FILE_FIELDS
          .map((field) => data[field]?.storagePath)
          .filter((path) => typeof path === 'string' && path.includes('guest_uploads')));
        const getUrl = async (fileData) => {
          if (!fileData) return null;
          try {
            if (fileData.storagePath) {
              // Driver-uploaded application files (CDL/medical card etc.) live under
              // guest_uploads. Their persisted `url` is a 15-min signed URL that has
              // expired by dossier-view time, and the client Storage SDK read is gated
              // by the narrow companyTeamIds claim (no super-admin bypass). Re-sign
              // server-side FIRST via the callable (RBAC'd by roles[companyId]/super_admin),
              // reusing this sign-in's link for ten minutes, then fall back to the
              // client SDK / stored url only if that fails.
              if (fileData.storagePath.includes('guest_uploads')) {
                try {
                  return await serverLinks[fileData.storagePath];
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
        // for all of them), and the tabs that draw them wait on `filesPending`.
        setFileUrls({});
        setFilesPending(true);
        setLoading(false);

        const urls = await Promise.all(FILE_FIELDS.map((field) => getUrl(data[field])));
        if (!current()) return;

        setFileUrls(Object.fromEntries(FILE_FIELDS.map((field, i) => [field, urls[i]])));
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
  }, [companyId, applicationId, collectionHint]);

  useEffect(() => {
    loadApplication();
  }, [loadApplication]);

  /**
   * The record read again after a change made from the dossier (a logged call),
   * so its stage and last call show. Quiet: no loading state, and the files stay
   * as they were signed. A read for a record no longer shown changes nothing.
   * One read when asked, not a listener on the record: a listener would pay a
   * read for every write to the record while the dossier is open (its own stage
   * and assignee changes, the server's DQ date), and make the dossier live.
   */
  const refreshRecord = useCallback(async () => {
    if (!companyId || !applicationId) return;
    const version = loadVersionRef.current;
    try {
      const snap = await getDoc(doc(db, "companies", companyId, collectionName, applicationId));
      if (version !== loadVersionRef.current || !snap.exists()) return;
      const data = snap.data();
      setAppData(data);
      setCurrentStatus(data.status || 'New Application');
    } catch (err) {
      console.error("Error refreshing the record:", err);
    }
  }, [companyId, applicationId, collectionName]);

  return {
    loading,
    error,
    appData,
    setAppData,
    refreshRecord,
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
