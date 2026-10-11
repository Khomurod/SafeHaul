import { useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * System Health's maintenance action and its output log.
 *
 * The Deep Diagnostic (it created test users and records in the live database
 * with a fixed password), "Sync Backend Structure" (it wrote schema defaults into
 * every live record missing a field) and the one-off SMS history backfill were
 * removed. `syncSystemStructure` now refuses on the server.
 */
export function useSystemHealth() {
    const [logs, setLogs] = useState([]);
    const [backfillStatus, setBackfillStatus] = useState('idle'); // idle, running, success, error

    const addLog = useCallback((message, type = 'info') => {
        setLogs(prev => [...prev, {
            id: Date.now() + Math.random(),
            time: new Date().toISOString(),
            message,
            type
        }]);
    }, []);

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

    return { logs, runBackfillProfiles, backfillStatus };
}
