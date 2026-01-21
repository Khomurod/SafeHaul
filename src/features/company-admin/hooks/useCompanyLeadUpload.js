import { useState, useEffect } from 'react';
import { db, auth } from '@lib/firebase';
import { writeBatch, collection, doc, serverTimestamp, query, where, getDocs, getDoc } from 'firebase/firestore';
import { formatPhoneNumber, normalizePhone } from '@shared/utils/helpers';

export function useCompanyLeadUpload(companyId, onUploadComplete) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');
  const [stats, setStats] = useState({ created: 0, updated: 0 });
  const [step, setStep] = useState('upload');
  
  const [assignmentMode, setAssignmentMode] = useState('unassigned');
  const [teamMembers, setTeamMembers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);

  useEffect(() => {
    if(!companyId) return;
    const fetchTeam = async () => {
        try {
            const q = query(collection(db, "memberships"), where("companyId", "==", companyId));
            const snap = await getDocs(q);
            const members = [];
            for(const m of snap.docs) {
                const userSnap = await getDoc(doc(db, "users", m.data().userId));
                if(userSnap.exists()) {
                    members.push({ id: userSnap.id, name: userSnap.data().name });
                }
            }
            setTeamMembers(members);
            setSelectedUserIds(members.map(m => m.id));
        } catch(e) { console.error("Error fetching team:", e); }
    };
    fetchTeam();
  }, [companyId]);

  const runDataRepair = async () => {
    if (!companyId) return;
    setUploading(true);
    setProgress("Scanning for misformatted data...");
    
    try {
        const leadsRef = collection(db, "companies", companyId, "leads");
        const snapshot = await getDocs(leadsRef);
        
        let batch = writeBatch(db);
        let opCount = 0;
        let fixedCount = 0;
        
        const isPhoneInEmail = (val) => {
            if (!val || val.includes('@') || val.includes('placeholder.com')) return false;
            const digitCount = val.replace(/\D/g, '').length;
            return digitCount >= 7;
        };

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const currentEmail = data.email || '';
            
            if (isPhoneInEmail(currentEmail)) {
                const newPhone = currentEmail;
                const newNormalized = normalizePhone(newPhone);
                const newFormatted = formatPhoneNumber(newPhone);
                
                const placeholderEmail = `no_email_${Date.now()}_${docSnap.id.substring(0,5)}@placeholder.com`;

                const updatePayload = {
                    email: placeholderEmail,
                    isEmailPlaceholder: true,
                    phone: newFormatted,
                    normalizedPhone: newNormalized,
                    updatedAt: serverTimestamp()
                };

                batch.update(docSnap.ref, updatePayload);
                fixedCount++;
                opCount++;

                if (opCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    opCount = 0;
                }
            }
        }

        if (opCount > 0) {
            await batch.commit();
        }
        
        setStats({ created: 0, updated: fixedCount });
        setStep('success');
        setProgress(`Repaired ${fixedCount} records.`);
        
        if (fixedCount > 0) {
            setTimeout(() => {
                if (onUploadComplete) onUploadComplete();
            }, 1500);
        } else {
            alert("Scan complete. No misformatted records found.");
            setUploading(false);
            setStep('upload');
        }

    } catch (error) {
        console.error("Repair Failed:", error);
        alert("Repair failed: " + error.message);
        setUploading(false);
    }
  };

  const uploadLeads = async (csvData, importMethod) => {
    if (assignmentMode === 'specific_user' && selectedUserIds.length !== 1) {
        throw new Error("Please select exactly one user for assignment.");
    }
    if (assignmentMode === 'round_robin' && selectedUserIds.length === 0) {
        throw new Error("Please select at least one user for Round Robin distribution.");
    }
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error("You must be logged in.");
    const currentUserName = currentUser.displayName || currentUser.email || "Admin";

    setUploading(true);
    setProgress('Syncing leads to database...');
    
    let distributionPool = [];
    if (assignmentMode !== 'unassigned') {
        distributionPool = teamMembers.filter(m => selectedUserIds.includes(m.id));
    }

    let createdCount = 0;
    let updatedCount = 0;

    try {
        const batchLimit = 200;
        let currentBatch = writeBatch(db);
        let opCount = 0;
        let poolIndex = 0;

        for (let i = 0; i < csvData.length; i++) {
            const data = csvData[i];
            setProgress(`Processing ${i + 1} / ${csvData.length}...`);

            let assignedTo = null;
            let assignedToName = null;

            if (assignmentMode !== 'unassigned' && distributionPool.length > 0) {
                const member = distributionPool[poolIndex % distributionPool.length];
                assignedTo = member.id;
                assignedToName = member.name;
                poolIndex++;
            }

            const leadsRef = collection(db, "companies", companyId, "leads");
            let existingDoc = null;

            if (!data.isEmailPlaceholder && data.email) {
                const qEmail = query(leadsRef, where("email", "==", data.email));
                const snapEmail = await getDocs(qEmail);
                if (!snapEmail.empty) existingDoc = snapEmail.docs[0];
            }
            
            if (!existingDoc && data.normalizedPhone) {
                const qPhone = query(leadsRef, where("normalizedPhone", "==", data.normalizedPhone));
                const snapPhone = await getDocs(qPhone);
                if (!snapPhone.empty) existingDoc = snapPhone.docs[0];
            }

            const leadPayload = {
                firstName: data.firstName || '',
                lastName: data.lastName || '',
                email: data.email || '',
                phone: data.phone || '',
                normalizedPhone: data.normalizedPhone || '',
                experience: data.experience || '',
                driverType: data.driverType || '',
                city: data.city || '',
                state: data.state || '',
                source: importMethod === 'gsheet' ? 'Company Import (Sheet)' : 'Company Import (File)',
                isPlatformLead: false,
                isEmailPlaceholder: !!data.isEmailPlaceholder,
                updatedAt: serverTimestamp()
            };

            const logData = {
                type: 'system',
                performedBy: currentUser.uid,
                performedByName: currentUserName,
                timestamp: serverTimestamp()
            };

            if (existingDoc) {
                currentBatch.update(existingDoc.ref, leadPayload);
                
                const logRef = collection(db, "companies", companyId, "leads", existingDoc.id, "activity_logs");
                const logDoc = doc(logRef);
                
                currentBatch.set(logDoc, {
                    ...logData,
                    action: "Lead Data Updated",
                    details: "Updated via Bulk Upload match."
                });
                updatedCount++;
            } else {
                const newLeadRef = doc(leadsRef);
                const newLeadData = {
                    ...leadPayload,
                    status: 'New Lead',
                    createdAt: serverTimestamp(),
                    assignedTo: assignedTo,
                    assignedToName: assignedToName
                };
                currentBatch.set(newLeadRef, newLeadData);

                const logRef = collection(db, "companies", companyId, "leads", newLeadRef.id, "activity_logs");
                const logDoc = doc(logRef);
                
                currentBatch.set(logDoc, {
                    ...logData,
                    action: "Lead Created",
                    details: "Created via Bulk Upload."
                });
                createdCount++;
            }

            opCount++;
            if (opCount >= batchLimit) { 
                await currentBatch.commit();
                currentBatch = writeBatch(db);
                opCount = 0;
            }
        }

        if (opCount > 0) {
            await currentBatch.commit();
        }

        setStats({ created: createdCount, updated: updatedCount });
        setStep('success');
        setTimeout(() => {
            if (onUploadComplete) onUploadComplete();
        }, 1500);

    } catch (err) {
        console.error("Batch Upload Error:", err);
        throw new Error(err.message || "Upload failed. Check permissions.");
    } finally {
        setUploading(false);
    }
  };

  return {
      uploading,
      progress,
      stats,
      step, setStep,
      assignmentMode, setAssignmentMode,
      teamMembers,
      selectedUserIds, setSelectedUserIds, 
      uploadLeads,
      runDataRepair
  };
}
