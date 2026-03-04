import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { ref, getDownloadURL } from "firebase/storage";
import { db, storage } from '@lib/firebase';
import { getCompanyProfile } from '@features/companies/services/companyService';

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
  const [currentStatus, setCurrentStatus] = useState('');
  const [teamMembers, setTeamMembers] = useState([]);
  const [assignedTo, setAssignedTo] = useState('');

  const isGlobal = companyId === 'general-leads';

  useEffect(() => {
    if (!companyId || isGlobal) return;

    const fetchTeam = async () => {
      // OPTIMIZATION: Use denormalized data if available
      if (companyProfile?.teamMembers && Array.isArray(companyProfile.teamMembers)) {
        setTeamMembers(companyProfile.teamMembers);
        return;
      }

      // FALLBACK: Manual fetch (Optimized to Parallel)
      try {
        const q = query(collection(db, "memberships"), where("companyId", "==", companyId));
        const snap = await simpleRetry(() => getDocs(q));

        const userPromises = snap.docs.map(m => getDoc(doc(db, "users", m.data().userId)));
        const userSnaps = await Promise.all(userPromises);

        const members = userSnaps
          .filter(s => s.exists())
          .map(s => ({ id: s.id, name: s.data().name || s.data().displayName || 'Unknown' }));

        setTeamMembers(members);
      } catch (e) {
        console.error("Failed to load team.", e);
      }
    };

    fetchTeam();
  }, [companyId, isGlobal, companyProfile]);

  const loadApplication = useCallback(async () => {
    if (!companyId || !applicationId) return;
    setLoading(true);
    setError('');

    try {
      if (!isGlobal) {
        const companyProf = await getCompanyProfile(companyId);
        setCompanyProfile(companyProf);
      } else {
        setCompanyProfile({ companyName: "General Pool (SafeHaul)" });
      }

      let coll = 'applications';
      let docRef;
      let docSnap;

      if (isGlobal) {
        coll = 'leads';
        docRef = doc(db, 'leads', applicationId);
        docSnap = await simpleRetry(() => getDoc(docRef));

        if (!docSnap.exists()) {
          coll = 'drivers';
          docRef = doc(db, 'drivers', applicationId);
          docSnap = await simpleRetry(() => getDoc(docRef));

          if (docSnap.exists()) {
            const d = docSnap.data();
            const flattened = {
              ...d,
              ...d.personalInfo,
              ...d.driverProfile,
              experience: d.qualifications?.experienceYears || '',
              source: 'Bulk Import'
            };
            docSnap = { exists: () => true, data: () => flattened, id: docSnap.id, ref: docSnap.ref };
          }
        }
      } else {
        docRef = doc(db, "companies", companyId, coll, applicationId);
        docSnap = await simpleRetry(() => getDoc(docRef));

        if (!docSnap.exists()) {
          coll = 'leads';
          docRef = doc(db, "companies", companyId, coll, applicationId);
          docSnap = await simpleRetry(() => getDoc(docRef));
        }
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

        const [cdl, cdlBack, ssc, medical, twic, mvrConsent, drugTestConsent, mvr] = await Promise.all([
          getUrl(data['cdl-front']), getUrl(data['cdl-back']), getUrl(data['ssc-upload']),
          getUrl(data['medical-card-upload']), getUrl(data['twic-card-upload']),
          getUrl(data['mvr-consent-upload']), getUrl(data['drug-test-consent-upload']),
          getUrl(data['mvr-upload'])
        ]);

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

      } else {
        setError(`Could not find record (ID: ${applicationId}).`);
      }
    } catch (err) {
      console.error("Error fetching document:", err);
      setError("Error: Could not load details.");
    } finally {
      setLoading(false);
    }
  }, [companyId, applicationId, isGlobal]);

  useEffect(() => {
    loadApplication();
  }, [loadApplication]);

  return {
    loading,
    error,
    appData,
    setAppData,
    companyProfile,
    collectionName,
    fileUrls,
    setFileUrls,
    teamMembers,
    currentStatus,
    setCurrentStatus,
    assignedTo,
    setAssignedTo,
    isGlobal,
    loadApplication,
    simpleRetry
  };
}
