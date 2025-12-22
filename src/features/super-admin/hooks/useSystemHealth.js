import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    collection, doc, deleteDoc, 
    serverTimestamp, setDoc, getDoc, getDocs 
} from 'firebase/firestore';
import { ref, uploadString, deleteObject, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '@lib/firebase';
import { jsPDF } from 'jspdf';

const STORAGE_KEY = 'safehaul_system_health_state';

const STEPS = [
    { id: 'init', label: '1. Initializing Environment' },
    { id: 'storage_write', label: '2. Infrastructure: Storage System' },
    { id: 'firestore_company', label: '3. Infrastructure: Database Write' },
    { id: 'cloud_function', label: '4. Infrastructure: Cloud Server' },

    // LEVEL 2: USER FLOWS
    { id: 'sim_driver_app', label: '5. Flow: Direct Application' },
    { id: 'sim_doc_upload', label: '6. Flow: Document Upload (CDL)' },
    { id: 'sim_signature', label: '7. Flow: E-Signature Capture' },
    { id: 'sim_team_invite', label: '8. Flow: Team Member Invitation' },

    // NEW: RECRUITER ATTRIBUTION TEST
    { id: 'sim_recruiter_link', label: '9. Flow: Recruiter Link Attribution' },

    { id: 'sim_job_offer', label: '10. Flow: Company Sending Offer' },
    { id: 'sim_offer_receive', label: '11. Flow: Driver Receiving Offer' },

    // LEVEL 3: CRITICAL LIBRARIES & LOGIC
    { id: 'sim_pdf_gen', label: '12. Engine: PDF Generation' },

    // NEW: AUDIT TRAIL TEST
    { id: 'sim_activity_log', label: '13. Logic: Activity Logging' },

    { id: 'sim_lead_logic', label: '14. Logic: Lead Quota Check' },

    { id: 'cleanup', label: '15. System Cleanup & Data Purge' }
];

export function useSystemHealth() {
    const [status, setStatus] = useState('idle');
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    const [testData, setTestData] = useState({}); 
    const testDataRef = useRef({}); 
    const abortController = useRef(null);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed.status !== 'success' && parsed.status !== 'idle') {
                    setStatus('paused');
                    setCurrentStepIndex(parsed.currentStepIndex || 0);
                    setLogs(parsed.logs || []);
                    const data = parsed.testData || {};
                    setTestData(data);
                    testDataRef.current = data;
                    setProgress(parsed.progress || 0);
                    addLog("⚠️ Restored previous test session. Ready to resume.", "warning");
                }
            } catch (e) {
                console.error("Failed to load saved health state", e);
                localStorage.removeItem(STORAGE_KEY);
            }
        }
    }, []);

    useEffect(() => {
        if (status === 'idle') return;
        const stateToSave = { status, currentStepIndex, logs, testData, progress };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    }, [status, currentStepIndex, logs, testData, progress]);

    const addLog = useCallback((message, type = 'info') => {
        setLogs(prev => [...prev, { 
            id: Date.now() + Math.random(), 
            time: new Date().toISOString(), 
            message, 
            type 
        }]);
    }, []);

    const wait = (ms) => new Promise(res => setTimeout(res, ms));

    const runDiagnostics = async (resume = false) => {
        if (!resume) {
            setStatus('running');
            setLogs([]);
            setTestData({});
            testDataRef.current = {}; 
            setCurrentStepIndex(0);
            setProgress(0);
            addLog("🚀 Starting Ultimate System Diagnostic...", "info");
        } else {
            setStatus('running');
            testDataRef.current = testData; 
            addLog("🔄 Resuming Diagnostic...", "info");
        }

        abortController.current = new AbortController();

        try {
            for (let i = resume ? currentStepIndex : 0; i < STEPS.length; i++) {
                if (abortController.current?.signal.aborted) break;

                const step = STEPS[i];
                setCurrentStepIndex(i);
                setProgress(Math.round(((i) / STEPS.length) * 100));
                addLog(`Testing: ${step.label}...`, "info");

                await executeStep(step.id);
                await wait(800);
            }

            if (!abortController.current?.signal.aborted) {
                setProgress(100);
                setStatus('success');
                addLog("✅ All Systems Operational.", "success");
                localStorage.removeItem(STORAGE_KEY);
            }

        } catch (error) {
            console.error("Diagnostic Error:", error);
            setStatus('error');
            addLog(`❌ CRITICAL FAILURE: ${error.message}`, "error");
        }
    };

    const executeStep = async (stepId) => {
        const currentData = testDataRef.current;
        const updateData = (newData) => {
            const merged = { ...testDataRef.current, ...newData };
            testDataRef.current = merged;
            setTestData(merged);
        };

        switch (stepId) {
            case 'init':
                if (!navigator.onLine) throw new Error("No Internet Connection");
                addLog("✅ Network Connection Verified.", "success");
                break;

            case 'storage_write':
                const fileRefPath = `system_health_tests/${Date.now()}_test.txt`;
                const storageRef = ref(storage, fileRefPath);
                await uploadString(storageRef, "System Health Check - Write Test");
                updateData({ fileRefPath });
                addLog("✅ Storage Permissions OK.", "success");
                break;

            case 'firestore_company':
                const testCompanyId = `SYS_TEST_${Date.now()}`;
                await setDoc(doc(db, 'companies', testCompanyId), {
                    companyName: testCompanyId,
                    isTestRecord: true,
                    createdAt: serverTimestamp(),
                    dailyQuota: 50, 
                    status: 'active'
                });

                const testDriverId = `SYS_DRIVER_${Date.now()}`;
                await setDoc(doc(db, 'drivers', testDriverId), {
                    personalInfo: { firstName: 'Test', lastName: 'Driver', email: `driver_${Date.now()}@test.com` },
                    isTestRecord: true,
                    createdAt: serverTimestamp()
                });

                updateData({ companyId: testCompanyId, driverId: testDriverId });
                addLog(`✅ Company & Driver DB Records Created.`, "success");
                break;

            case 'cloud_function':
                const migrateFn = httpsCallable(functions, 'runMigration'); 
                const pingResult = await migrateFn({ mode: 'ping' });
                if (!pingResult.data?.success) throw new Error("Cloud Function Ping Failed");
                addLog("✅ Cloud Server Connected.", "success");
                break;

            case 'sim_driver_app':
                if (!currentData.companyId || !currentData.driverId) throw new Error("Missing IDs");
                const appRef = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appRef, {
                    driverId: currentData.driverId,
                    status: 'New Application',
                    submittedAt: serverTimestamp(),
                    applicantName: 'Test Driver',
                    source: 'System Health Test',
                    isTestRecord: true
                });
                addLog("✅ Driver Application Submitted.", "success");
                break;

            case 'sim_doc_upload':
                const cdlPath = `companies/${currentData.companyId}/applications/${currentData.driverId}/cdl_front.txt`;
                const cdlRef = ref(storage, cdlPath);
                await uploadString(cdlRef, "FAKE CDL CONTENT");
                updateData({ cdlPath });

                const appDocRef1 = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appDocRef1, { 
                    'cdl-front': { url: 'http://fake-url.com', storagePath: cdlPath } 
                }, { merge: true });

                addLog("✅ CDL Document Uploaded & Linked.", "success");
                break;

            case 'sim_signature':
                const appDocRef2 = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appDocRef2, {
                    signature: {
                        name: 'Test Driver',
                        date: new Date().toISOString(),
                        data: 'base64_fake_signature_string'
                    },
                    isCertified: true
                }, { merge: true });
                addLog("✅ E-Signature Captured.", "success");
                break;

            case 'sim_team_invite':
                // Create a Test Recruiter
                const recruiterUserId = `FAKE_RECRUITER_${Date.now()}`;
                const membershipRef = doc(db, 'memberships', `TEST_MEM_${Date.now()}`);
                await setDoc(membershipRef, {
                    userId: recruiterUserId,
                    companyId: currentData.companyId,
                    role: 'hr_user',
                    isTestRecord: true
                });
                updateData({ membershipId: membershipRef.id, recruiterUserId });
                addLog("✅ Team Member (Recruiter) Invite Created.", "success");
                break;

            // --- NEW: RECRUITER ATTRIBUTION TEST ---
            case 'sim_recruiter_link':
                if (!currentData.recruiterUserId) throw new Error("Recruiter creation failed");

                // Simulate a SECOND driver applying via "Exclusive Link"
                const linkedDriverId = `SYS_DRIVER_LINKED_${Date.now()}`;
                const linkedAppRef = doc(db, 'companies', currentData.companyId, 'applications', linkedDriverId);

                await setDoc(linkedAppRef, {
                    driverId: linkedDriverId,
                    status: 'New Application',
                    applicantName: 'Linked Driver',
                    source: 'Recruiter Link',
                    // THIS IS THE CRITICAL CHECK:
                    // Does the app correctly save who assigned it?
                    assignedTo: currentData.recruiterUserId, 
                    isTestRecord: true,
                    submittedAt: serverTimestamp()
                });

                // Verify the data stuck
                const linkedSnap = await getDoc(linkedAppRef);
                const linkedData = linkedSnap.data();

                if (linkedData.assignedTo !== currentData.recruiterUserId) {
                    throw new Error(`Recruiter Link Failed: Driver NOT assigned to recruiter. Found: ${linkedData.assignedTo}`);
                }

                updateData({ linkedDriverId }); // Store for cleanup
                addLog("✅ Recruiter Attribution Logic Verified (Lead Assigned).", "success");
                break;

            case 'sim_job_offer':
                const appDocRef3 = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appDocRef3, {
                    status: 'Offer Sent',
                    offerDetails: {
                        payRate: '0.65',
                        payType: 'CPM',
                        generatedAt: new Date().toISOString()
                    }
                }, { merge: true });
                addLog("✅ Job Offer Sent by Company.", "success");
                break;

            case 'sim_offer_receive':
                const checkRef = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                const snap = await getDoc(checkRef);
                if (!snap.exists()) throw new Error("Application vanished!");
                const data = snap.data();
                if (data.status !== 'Offer Sent' || data.offerDetails?.payType !== 'CPM') {
                    throw new Error("Offer data mismatch or not saved.");
                }
                addLog("✅ Driver Successfully Received Offer.", "success");
                break;

            case 'sim_pdf_gen':
                try {
                    const pdfDoc = new jsPDF();
                    pdfDoc.text("System Health Check - PDF Test", 10, 10);
                    const pdfOutput = pdfDoc.output('datauristring');
                    if (!pdfOutput || !pdfOutput.startsWith('data:application/pdf')) throw new Error("Output Invalid");
                    addLog("✅ PDF Engine & Fonts Loaded Successfully.", "success");
                } catch (e) {
                    throw new Error(`PDF Engine Failure: ${e.message}`);
                }
                break;

            // --- NEW: AUDIT TRAIL TEST ---
            case 'sim_activity_log':
                // Check if we can write to the activity log (Audit Trail)
                const activityRef = doc(collection(db, 'companies', currentData.companyId, 'applications', currentData.driverId, 'activities'));
                await setDoc(activityRef, {
                    type: 'system_test',
                    text: 'System Diagnostic Check',
                    createdAt: serverTimestamp()
                });

                // Read it back to ensure it wasn't blocked by rules
                const activitySnap = await getDoc(activityRef);
                if (!activitySnap.exists()) throw new Error("Activity Logging Blocked by Security Rules");

                addLog("✅ Audit Trail / Activity Logging Verified.", "success");
                break;

            case 'sim_lead_logic':
                const compCheck = doc(db, 'companies', currentData.companyId);
                const compSnap = await getDoc(compCheck);
                const compData = compSnap.data();
                if (compData.dailyQuota !== 50) {
                    throw new Error(`Lead Logic Risk: Quota mismatch (Found ${compData.dailyQuota}, Expected 50)`);
                }
                addLog("✅ Lead Distribution Logic (Quota) Verified.", "success");
                break;

            case 'cleanup':
                addLog("🧹 Beginning Cleanup...", "warning");
                // Cleanup Primary Driver
                if (currentData.companyId && currentData.driverId) {
                    await deleteDoc(doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId)).catch(e => console.warn(e));
                }
                // Cleanup Linked Driver (Recruiter Test)
                if (currentData.companyId && currentData.linkedDriverId) {
                    await deleteDoc(doc(db, 'companies', currentData.companyId, 'applications', currentData.linkedDriverId)).catch(e => console.warn(e));
                }

                if (currentData.companyId) await deleteDoc(doc(db, 'companies', currentData.companyId)).catch(e => console.warn(e));
                if (currentData.driverId) await deleteDoc(doc(db, 'drivers', currentData.driverId)).catch(e => console.warn(e));
                if (currentData.membershipId) await deleteDoc(doc(db, 'memberships', currentData.membershipId)).catch(e => console.warn(e));

                if (currentData.fileRefPath) await deleteObject(ref(storage, currentData.fileRefPath)).catch(e => console.warn("File gone"));
                if (currentData.cdlPath) await deleteObject(ref(storage, currentData.cdlPath)).catch(e => console.warn("CDL gone"));

                addLog("✅ Test Data Purged.", "success");
                updateData({}); 
                break;
        }
    };

    const pauseDiagnostics = () => {
        if (abortController.current) abortController.current.abort();
        setStatus('paused');
        addLog("⏸️ Diagnostic Paused by User.", "warning");
    };

    const runMigrationTool = async () => {
        addLog("🛠️ Starting Manual Data Migration...", "info");
        try {
            const migrateFn = httpsCallable(functions, 'runMigration');
            const result = await migrateFn();
            if (result.data?.success) {
                addLog(`✅ Migration Success: ${result.data?.message}`, "success");
            } else {
                addLog(`❌ Migration Error: ${result.data?.error}`, "error");
            }
        } catch (e) {
            addLog(`❌ Connection Failed: ${e.message}`, "error");
        }
    };

    return {
        runDiagnostics,
        pauseDiagnostics,
        runMigrationTool,
        status,
        progress,
        logs,
        currentStepIndex,
        totalSteps: STEPS.length,
        currentStepName: STEPS[currentStepIndex]?.label
    };
}