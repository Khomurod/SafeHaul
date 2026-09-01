import { addDoc, getDoc, getDocs, doc, query, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';

/**
 * The DQ tab's fetch-and-auto-sync routine, extracted verbatim from
 * `DQFileTab.jsx` — see that file's header for the frozen contracts. The
 * eight `syncTargets` field→type mappings and their expiration fields must
 * stay in step with `driverSync.js`. Everything the inline closure captured
 * (the collection ref, the path segments, the three state setters) arrives
 * through the argument object, so the behaviour is the closure's.
 */
export async function fetchAndSyncDqFiles({
  dqFilesCollectionRef,
  companyId,
  collectionName,
  applicationId,
  setDqFiles,
  setLoading,
  setError,
}) {
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
}
