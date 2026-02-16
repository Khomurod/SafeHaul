import React, { useState, useEffect } from 'react';
import { db, functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, limit, getDocs, orderBy } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';

export default function DetailedReportModal({ companyId, sessionId, isOpen, onClose }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);
    const { showSuccess, showError } = useToast();

    // ... (useEffect for fetching logs remains same)
    useEffect(() => {
        if (!isOpen || !companyId || !sessionId) return;

        const fetchLogs = async () => {
            try {
                setLoading(true);
                const logsRef = collection(db, 'companies', companyId, 'bulk_sessions', sessionId, 'logs');
                // Order by timestamp desc, limit to 200 to see more
                const q = query(logsRef, orderBy('timestamp', 'desc'), limit(200));
                const snapshot = await getDocs(q);

                const fetchedLogs = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setLogs(fetchedLogs);
            } catch (error) {
                console.error("Error fetching logs:", error);
                showError("Failed to load delivery details. Check permissions.");
            } finally {
                setLoading(false);
            }
        };

        fetchLogs();
    }, [isOpen, companyId, sessionId]);

    const handleRetry = async () => {
        if (!confirm("Start a new campaign for FAILED recipients only? This will retry permanent errors too.")) return;

        try {
            setRetrying(true);
            const retryFn = httpsCallable(functions, 'retryFailedAttempts');
            const result = await retryFn({
                companyId,
                originalSessionId: sessionId
            });

            if (result.data.success) {
                showSuccess(`Retry session started with ${result.data.targetCount} targets.`);
                onClose();
            } else {
                showError(result.data.message || "Retry failed to start.");
            }
        } catch (err) {
            console.error(err);
            showError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    const hasFailures = logs.some(l => l.status === 'failed' || (l.isSuccess === false));

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
            <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">

                <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" aria-hidden="true" onClick={onClose}></div>

                <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

                <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full sm:p-6">
                    <div className="absolute top-0 right-0 pt-4 pr-4">
                        <button
                            type="button"
                            className="bg-white rounded-md text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                            onClick={onClose}
                        >
                            <span className="sr-only">Close</span>
                            <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="sm:flex sm:items-start">
                        <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left w-full">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                                    Delivery Report
                                </h3>
                                {hasFailures && (
                                    <button
                                        onClick={handleRetry}
                                        disabled={retrying}
                                        className="bg-red-50 text-red-600 px-3 py-1 rounded-md text-sm font-bold border border-red-200 hover:bg-red-100 transition-colors"
                                    >
                                        {retrying ? 'Starting...' : 'Retry Failed Requests'}
                                    </button>
                                )}
                            </div>

                            <div className="mt-4 flex flex-col">
                                <div className="-my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
                                    <div className="py-2 align-middle inline-block min-w-full sm:px-6 lg:px-8">
                                        <div className="shadow overflow-hidden border-b border-gray-200 sm:rounded-lg max-h-96 overflow-y-auto">
                                            <table className="min-w-full divide-y divide-gray-200">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                            Recipient
                                                        </th>
                                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                            Contact
                                                        </th>
                                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                            Status
                                                        </th>
                                                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                            Error Detail
                                                        </th>
                                                    </tr>
                                                </thead>
                                                <tbody className="bg-white divide-y divide-gray-200">
                                                    {loading ? (
                                                        <tr>
                                                            <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">
                                                                Loading logs...
                                                            </td>
                                                        </tr>
                                                    ) : logs.length === 0 ? (
                                                        <tr>
                                                            <td colSpan="4" className="px-6 py-4 text-center text-sm text-gray-500">
                                                                No activity logs found. Ensure permissions are set.
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        logs.map((log) => (
                                                            <tr key={log.id}>
                                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                                    {log.recipientName || 'Unknown'}
                                                                </td>
                                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                    {log.recipientIdentity || 'N/A'}
                                                                </td>
                                                                <td className="px-6 py-4 whitespace-nowrap">
                                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${log.status === 'delivered' || log.isSuccess
                                                                        ? 'bg-green-100 text-green-800'
                                                                        : 'bg-red-100 text-red-800'
                                                                        }`}>
                                                                        {log.status === 'delivered' || log.isSuccess ? 'Delivered' : 'Failed'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                                                                    {log.error || '-'}
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                        <button
                            type="button"
                            className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                            onClick={onClose}
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
