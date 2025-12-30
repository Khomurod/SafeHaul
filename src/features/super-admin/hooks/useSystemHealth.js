import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    collection, doc, deleteDoc, 
    serverTimestamp, setDoc, getDoc, getDocs, query, where
} from 'firebase/firestore';
import { ref, uploadString, deleteObject, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '@lib/firebase';
import { jsPDF } from 'jspdf';
import { getAuth } from 'firebase/auth';

const STORAGE_KEY = 'safehaul_system_health_state';

const STEPS = [
    { id: 'init', label: '1. Initializing Environment' },
    { id: 'storage_write', label: '2. Infrastructure: Storage System' },
    { id: 'firestore_company', label: '3. Infrastructure: Database Write' },
    { id: 'cloud_function', label: '4. Infrastructure: Cloud Server' },
    { id: 'sim_driver_app', label: '5. Flow: Direct Application (Slug)' },
    { id: 'sim_doc_upload', label: '6. Flow: Document Upload (CDL)' },
    { id: 'sim_signature', label: '7. Flow: E-Signature Capture' },
    { id: 'test_user_access', label: '8. Security: User Creation & Reassignment' },
    { id: 'sim_recruiter_link', label: '9. Flow: Recruiter Link Attribution' },
    { id: 'sim_job_offer', label: '10. Flow: Company Sending Offer' },
    { id: 'sim_offer_receive', label: '11. Flow: Driver Receiving Offer' },
    { id: 'sim_safehaul_lead', label: '12. Data: SafeHaul & Personal Leads' },
    { id: 'sim_pdf_gen', label: '13. Engine: PDF Generation' },
    { id: 'sim_activity_log', label: '14. Logic: Audit Trail Logging' },
    { id: 'test_visibility', label: '15. Data: Dashboard Visibility (All Views)' },
    { id: 'test_integrity', label: '16. Data: DB <-> Storage Alignment' },
    { id: 'cleanup', label: '17. System Cleanup & Data Purge' }
];

export function useSystemHealth() {
    const [status, setStatus] = useState('idle');
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    // Repair State
    const [repairStatus, setRepairStatus] = useState('idle'); // idle, running, success, error

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

    // --- NEW: SYSTEM REPAIR FUNCTION ---
    const runSystemRepair = async () => {
        setRepairStatus('running');
        addLog("🛠️ Initiating System Structure Repair...", "info");
        try {
            const repairFn = httpsCallable(functions, 'syncSystemStructure');
            const result = await repairFn();

            if (result.data.success) {
                setRepairStatus('success');
                addLog(`✅ Repair Complete: ${result.data.message}`, "success");
                addLog(`📊 Stats: Scanned ${result.data.stats.companies + result.data.stats.leads} docs, Fixed ${result.data.stats.fixes} issues.`, "success");
            } else {
                throw new Error(result.data.message || "Unknown failure");
            }
        } catch (error) {
            console.error("Repair failed:", error);
            setRepairStatus('error');
            addLog(`❌ Repair Failed: ${error.message}`, "error");
        }
    };

    const runDiagnostics = async (resume = false) => {
        if (!resume) {
            setStatus('running');
            setLogs([]);
            setTestData({});
            testDataRef.current = {}; 
            setCurrentStepIndex(0);
            setProgress(0);
            addLog("🚀 Starting Comprehensive System Diagnostic...", "info");
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
                await wait(1000); 
            }

            if (!abortController.current?.signal.aborted) {
                setProgress(100);
                setStatus('success');
                addLog("✅ All Systems Operational. Test Complete.", "success");
                localStorage.removeItem(STORAGE_KEY);
            }

        } catch (error) {
            console.error("Diagnostic Error:", error);
            setStatus('error');
            addLog(`❌ FAILURE: ${error.message}`, "error");
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
                const fileRefPath = `system_health_tests/SYS_TEST_${Date.now()}.txt`;
                const storageRef = ref(storage, fileRefPath);
                await uploadString(storageRef, "System Health Check - Write Test");
                updateData({ fileRefPath });
                addLog("✅ Storage Write Access Verified.", "success");
                break;

            case 'firestore_company':
                const testCompanyId = `SYS_TEST_${Date.now()}`;
                await setDoc(doc(db, 'companies', testCompanyId), {
                    companyName: "Test Company A",
                    appSlug: `test-slug-${Date.now()}`,
                    isTestRecord: true,
                    createdAt: serverTimestamp(),
                    dailyQuota: 50, 
                    status: 'active'
                });

                const testCompanyIdB = `SYS_TEST_B_${Date.now()}`;
                await setDoc(doc(db, 'companies', testCompanyIdB), {
                    companyName: "Test Company B",
                    isTestRecord: true
                });

                const testDriverId = `SYS_DRIVER_${Date.now()}`;
                await setDoc(doc(db, 'drivers', testDriverId), {
                    personalInfo: { firstName: 'Test', lastName: 'Driver', email: `driver_${Date.now()}@test.com` },
                    isTestRecord: true,
                    createdAt: serverTimestamp()
                });

                updateData({ companyId: testCompanyId, companyIdB: testCompanyIdB, driverId: testDriverId });
                addLog(`✅ Test Companies & Driver Created.`, "success");
                break;

            case 'cloud_function':
                const migrateFn = httpsCallable(functions, 'runMigration'); 
                const pingResult = await migrateFn({ mode: 'ping' });
                if (!pingResult.data?.success) throw new Error("Cloud Function Ping Failed");
                addLog("✅ Cloud Functions are Responding.", "success");
                break;

            case 'sim_driver_app':
                if (!currentData.companyId || !currentData.driverId) throw new Error("Missing IDs");
                const appRef = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appRef, {
                    driverId: currentData.driverId,
                    status: 'New Application',
                    submittedAt: serverTimestamp(),
                    applicantName: 'Test Driver',
                    source: 'Slug Apply', 
                    companyId: currentData.companyId, 
                    isTestRecord: true
                });
                addLog("✅ Driver Application Submitted via Slug.", "success");
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

                addLog("✅ CDL Document Uploaded & Linked to Profile.", "success");
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
                addLog("✅ E-Signature Successfully Captured.", "success");
                break;

            case 'test_user_access':
                const tempEmail = `systest_${Date.now()}@example.com`;
                const tempPass = "Test1234!";

                addLog(".. Creating temporary user...", "info");
                const createFn = httpsCallable(functions, 'createPortalUser');
                const createRes = await createFn({
                    fullName: "System Test User",
                    email: tempEmail,
                    password: tempPass,
                    companyId: currentData.companyId,
                    role: 'hr_user'
                });

                if (!createRes.data?.userId) throw new Error("User creation failed (No UID returned)");
                const tempUserId = createRes.data.userId;
                updateData({ tempUserId });

                const memQ1 = query(collection(db, 'memberships'), where("userId", "==", tempUserId), where("companyId", "==", currentData.companyId));
                const snap1 = await getDocs(memQ1);
                if (snap1.empty) throw new Error("User created but NOT assigned to Company A.");
                addLog(".. User assigned to Company A.", "info");

                const oldMemId = snap1.docs[0].id;
                await deleteDoc(doc(db, 'memberships', oldMemId));

                await setDoc(doc(db, 'memberships', `TEMP_MEM_${Date.now()}`), {
                    userId: tempUserId,
                    companyId: currentData.companyIdB,
                    role: 'company_admin',
                    isTestRecord: true
                });

                const memQ2 = query(collection(db, 'memberships'), where("userId", "==", tempUserId), where("companyId", "==", currentData.companyIdB));
                const snap2 = await getDocs(memQ2);
                if (snap2.empty) throw new Error("Reassignment Failed: User not found in Company B.");

                addLog("✅ User Access Cycle (Create -> Assign -> Reassign) Verified.", "success");
                break;

            case 'sim_recruiter_link':
                const recruiterId = `TEST_REC_${Date.now()}`;
                const linkedAppRef = doc(db, 'companies', currentData.companyId, 'applications', `LINKED_APP_${Date.now()}`);
                await setDoc(linkedAppRef, {
                    status: 'New Application',
                    applicantName: 'Linked Driver',
                    source: 'Recruiter Link',
                    assignedTo: recruiterId, 
                    isTestRecord: true,
                    submittedAt: serverTimestamp()
                });

                const linkedSnap = await getDoc(linkedAppRef);
                if (linkedSnap.data().assignedTo !== recruiterId) {
                    throw new Error("Recruiter Link Logic Failed: 'assignedTo' field missing or incorrect.");
                }
                updateData({ linkedAppId: linkedAppRef.id });
                addLog("✅ Recruiter Attribution Logic Verified.", "success");
                break;

            case 'sim_job_offer':
                const appRefOffer = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                await setDoc(appRefOffer, {
                    status: 'Offer Sent',
                    offerDetails: {
                        payRate: '0.70',
                        payType: 'CPM',
                        generatedAt: new Date().toISOString()
                    }
                }, { merge: true });
                addLog("✅ Job Offer Sent.", "success");
                break;

            case 'sim_offer_receive':
                const checkRef = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                const snap = await getDoc(checkRef);
                if (snap.data().status !== 'Offer Sent') throw new Error("Status update failed.");
                addLog("✅ Driver Received Offer.", "success");
                break;

            case 'sim_safehaul_lead':
                const globalLeadId = `SH_LEAD_${Date.now()}`;
                await setDoc(doc(db, 'leads', globalLeadId), {
                    name: "SafeHaul Test Lead",
                    status: 'active',
                    isTestRecord: true,
                    createdAt: serverTimestamp()
                });

                const currentUser = getAuth().currentUser;
                let myLeadId = null;
                if (currentUser) {
                    myLeadId = `MY_LEAD_${Date.now()}`;
                    await setDoc(doc(db, 'companies', currentData.companyId, 'leads', myLeadId), {
                        name: "Personal Assigned Lead",
                        status: 'new',
                        assignedTo: currentUser.uid, 
                        isTestRecord: true
                    });
                } else {
                    addLog("⚠️ Skipping 'My Leads' creation (No Admin logged in).", "warning");
                }

                updateData({ globalLeadId, myLeadId });
                addLog("✅ SafeHaul & Personal Leads Created.", "success");
                break;

            case 'sim_pdf_gen':
                try {
                    const pdfDoc = new jsPDF();
                    pdfDoc.text("System Health Check", 10, 10);
                    const out = pdfDoc.output('datauristring');
                    if (!out.startsWith('data:application/pdf')) throw new Error("Invalid PDF header");
                    addLog("✅ PDF Generation Engine OK.", "success");
                } catch (e) {
                    throw new Error(`PDF Engine Error: ${e.message}`);
                }
                break;

            case 'sim_activity_log':
                const logRef = doc(collection(db, 'companies', currentData.companyId, 'applications', currentData.driverId, 'activities'));
                await setDoc(logRef, { type: 'test', text: 'Audit Log Test', createdAt: serverTimestamp() });
                const logSnap = await getDoc(logRef);
                if (!logSnap.exists()) throw new Error("Activity Log failed to write.");
                addLog("✅ Audit/Activity Logging OK.", "success");
                break;

            case 'test_visibility':
                const qApps = query(collection(db, 'companies', currentData.companyId, 'applications'));
                const snapApps = await getDocs(qApps);
                const foundApp = snapApps.docs.find(d => d.id === currentData.driverId);
                if (!foundApp) throw new Error("Dashboard Visibility Error: Application not showing in query.");

                const leadRef = doc(collection(db, 'companies', currentData.companyId, 'leads'));
                await setDoc(leadRef, { name: "Standard Company Lead", status: 'new', isTestRecord: true });
                const qLeads = query(collection(db, 'companies', currentData.companyId, 'leads'));
                const snapLeads = await getDocs(qLeads);
                if (snapLeads.empty) throw new Error("Dashboard Visibility Error: Leads not showing in query.");

                if (currentData.globalLeadId) {
                    const shLeadSnap = await getDoc(doc(db, 'leads', currentData.globalLeadId));
                    if (!shLeadSnap.exists()) throw new Error("Visibility Error: SafeHaul (Global) lead not retrievable.");
                }

                if (currentData.myLeadId) {
                    const currentUser = getAuth().currentUser;
                    const qMyLeads = query(
                        collection(db, 'companies', currentData.companyId, 'leads'),
                        where("assignedTo", "==", currentUser.uid)
                    );
                    const snapMyLeads = await getDocs(qMyLeads);
                    if (snapMyLeads.empty) throw new Error("Visibility Error: 'My Leads' query returned empty.");
                }

                addLog("✅ Dashboard Visibility Verified (Apps, Company Leads, SafeHaul, My Leads).", "success");
                break;

            case 'test_integrity':
                const integAppRef = doc(db, 'companies', currentData.companyId, 'applications', currentData.driverId);
                const integSnap = await getDoc(integAppRef);
                const storedPath = integSnap.data()['cdl-front']?.storagePath;

                if (!storedPath) throw new Error("Integrity Fail: DB missing file path.");

                try {
                    const fileRef = ref(storage, storedPath);
                    await getDownloadURL(fileRef);
                    addLog("✅ Database <-> Storage Alignment OK.", "success");
                } catch (storageErr) {
                    throw new Error(`Integrity Fail: File in DB but not in Storage. Path: ${storedPath}`);
                }
                break;

            case 'cleanup':
                addLog("🧹 Starting cleanup...", "info");
                const data = testDataRef.current;

                if (data.companyId) {
                    try {
                        const appsQuery = query(collection(db, 'companies', data.companyId, 'applications'));
                        const appsSnap = await getDocs(appsQuery);
                        for (const appDoc of appsSnap.docs) {
                            await deleteDoc(appDoc.ref);
                        }
                        const leadsQuery = query(collection(db, 'companies', data.companyId, 'leads'));
                        const leadsSnap = await getDocs(leadsQuery);
                        for (const leadDoc of leadsSnap.docs) {
                            await deleteDoc(leadDoc.ref);
                        }
                        await deleteDoc(doc(db, 'companies', data.companyId));
                    } catch (e) {
                        console.error("Cleanup company A error:", e);
                    }
                }

                if (data.companyIdB) {
                    try {
                        await deleteDoc(doc(db, 'companies', data.companyIdB));
                    } catch (e) {
                        console.error("Cleanup company B error:", e);
                    }
                }

                if (data.driverId) {
                    try {
                        await deleteDoc(doc(db, 'drivers', data.driverId));
                    } catch (e) {
                        console.error("Cleanup driver error:", e);
                    }
                }

                if (data.globalLeadId) {
                    try {
                        await deleteDoc(doc(db, 'leads', data.globalLeadId));
                    } catch (e) {
                        console.error("Cleanup global lead error:", e);
                    }
                }

                if (data.fileRefPath) {
                    try {
                        await deleteObject(ref(storage, data.fileRefPath));
                    } catch (e) {
                        console.error("Cleanup storage file error:", e);
                    }
                }

                if (data.cdlPath) {
                    try {
                        await deleteObject(ref(storage, data.cdlPath));
                    } catch (e) {
                        console.error("Cleanup CDL file error:", e);
                    }
                }

                try {
                    const memQuery = query(collection(db, 'memberships'), where("isTestRecord", "==", true));
                    const memSnap = await getDocs(memQuery);
                    for (const memDoc of memSnap.docs) {
                        await deleteDoc(memDoc.ref);
                    }
                } catch (e) {
                    console.error("Cleanup memberships error:", e);
                }

                addLog("✅ All test data cleaned up.", "success");
                break;

            default:
                addLog(`⚠️ Unknown step: ${stepId}`, "warning");
        }
    };

    const pauseDiagnostics = () => {
        abortController.current?.abort();
        setStatus('paused');
        addLog("⏸️ Diagnostics Paused.", "warning");
    };

    const resetDiagnostics = () => {
        abortController.current?.abort();
        setStatus('idle');
        setCurrentStepIndex(0);
        setProgress(0);
        setLogs([]);
        setTestData({});
        testDataRef.current = {};
        localStorage.removeItem(STORAGE_KEY);
    };

    return {
        status,
        currentStep: STEPS[currentStepIndex],
        progress,
        logs,
        steps: STEPS,
        runDiagnostics,
        pauseDiagnostics,
        resetDiagnostics,
        runSystemRepair, // <--- NEW EXPORT
        repairStatus     // <--- NEW EXPORT
    };
}