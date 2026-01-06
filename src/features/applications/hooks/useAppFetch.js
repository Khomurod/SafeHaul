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
      if(!companyId || isGlobal) return;
      const fetchTeam = async () => {
          try {
              const q = query(collection(db, "memberships"), where("companyId", "==", companyId));
              const snap = await simpleRetry(() => getDocs(q));
              const members = [];
              for(const m of snap.docs) {
                  try {
                      const uSnap = await getDoc(doc(db, "users", m.data().userId));
                      if(uSnap.exists()) members.push({ id: uSnap.id, name: uSnap.data().name });
                  } catch (innerErr) {
                     console.warn("Failed to fetch team member details", innerErr);
                  }
              }
              setTeamMembers(members);
          } catch(e) {
              console.error("Failed to load team.", e);
          }
      };
      fetchTeam();
  }, [companyId, isGlobal]);

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
                 return await getDownloadURL(ref(storage, fileData.storagePath));
              }
              return fileData.url || null;
          } catch (e) { 
              return null;
          }
        };

        const [cdl, cdlBack, ssc, medical, twic, mvrConsent, drugTestConsent] = await Promise.all([
          getUrl(data['cdl-front']), getUrl(data['cdl-back']), getUrl(data['ssc-upload']),
          getUrl(data['med-card-upload']), getUrl(data['twic-card-upload']),
          getUrl(data['mvr-consent-upload']), getUrl(data['drug-test-consent-upload'])
        ]);
        
        setFileUrls({ cdl, cdlBack, ssc, medical, twic, mvrConsent, drugTestConsent });
        
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
