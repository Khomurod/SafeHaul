import { useState, useEffect, useCallback, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { STEPS, executeHealthStep } from './systemHealthSteps';

const STORAGE_KEY = 'safehaul_system_health_state';



export function useSystemHealth() {
    const [status, setStatus] = useState('idle');
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [progress, setProgress] = useState(0);
    const [logs, setLogs] = useState([]);

    // Repair State
    const [repairStatus, setRepairStatus] = useState('idle'); // idle, running, success, error
    const [backfillStatus, setBackfillStatus] = useState('idle'); // idle, running, success, error
    const [smsBackfillStatus, setSmsBackfillStatus] = useState('idle'); // idle, running, success, error

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

    // --- BACKFILL PUBLIC PROFILES ---
    const runBackfillProfiles = async () => {
        setBackfillStatus('running');
        addLog("🔄 Starting Public Profiles Backfill...", "info");
        try {
            const backfillFn = httpsCallable(functions, 'backfillPublicProfiles');
            const result = await backfillFn();

            if (result.data.success) {
                setBackfillStatus('success');
                addLog(`✅ Backfill Complete: ${result.data.message}`, "success");
            } else {
                throw new Error(result.data.error || "Unknown failure");
            }
        } catch (error) {
            console.error("Backfill failed:", error);
            setBackfillStatus('error');
            addLog(`❌ Backfill Failed: ${error.message}`, "error");
        }
    };

    // --- BACKFILL SMS SENT PHONES (ALL COMPANIES) ---
    // BUG-14 FIX: The entire per-company loop now happens server-side inside
    // `backfillAllSmsSentPhones`. The browser only fires the trigger and waits
    // for the aggregate result, so the operator can leave the tab in the
    // background, switch tabs, or even close it (the function still runs to
    // completion on the server). Re-run the action if `truncated === true` to
    // pick up where the previous invocation left off.
    const runSmsBackfill = async () => {
        setSmsBackfillStatus('running');
        addLog("📱 Starting global SMS History Backfill (server-side)...", "info");
        try {
            // The server-side sweep can run up to 8 minutes — bump the client
            // callable timeout so we don't see a spurious deadline-exceeded
            // before the function actually finishes. (Default is 70s.)
            const backfillAllFn = httpsCallable(functions, 'backfillAllSmsSentPhones', { timeout: 9 * 60 * 1000 });
            const result = await backfillAllFn({});
            const data = result.data || {};

            if (!data.success) {
                throw new Error(data.message || 'Backfill returned an unsuccessful result.');
            }

            (data.summaries || []).forEach(s => {
                if (s.ok) {
                    addLog(`  ✅ ${s.companyId}: ${s.phonesBackfilled || 0} phones / ${s.sessionsProcessed || 0} sessions.`, 'success');
                } else {
                    addLog(`  ❌ ${s.companyId}: ${s.error || 'Unknown error'}`, 'error');
                }
            });

            if (data.truncated) {
                addLog(`⚠️ Partial run: ${data.processedCompanies}/${data.totalCompanies} processed before the server cut-off. Click again to continue.`, 'warning');
            }

            setSmsBackfillStatus('success');
            addLog(`✅ ${data.message}`, 'success');
        } catch (error) {
            console.error("SMS Backfill failed:", error);
            setSmsBackfillStatus('error');
            addLog(`❌ SMS Backfill Failed: ${error.message}`, "error");
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
        await executeHealthStep(stepId, {
            currentData,
            updateData,
            addLog,
            getData: () => testDataRef.current,
        });
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
        runSystemRepair,
        repairStatus,
        runBackfillProfiles,
        backfillStatus,
        runSmsBackfill,
        smsBackfillStatus
    };
}
