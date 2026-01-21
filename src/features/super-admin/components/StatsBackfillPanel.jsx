import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Play, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function StatsBackfillPanel() {
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const runBackfill = async (companyId, dryRun) => {
        setLoading(true);
        setError('');
        setResult(null);

        try {
            // Set 9-minute timeout for large data processing
            const backfillFn = httpsCallable(functions, 'backfillCompanyStats', {
                timeout: 540000 // 9 minutes
            });
            const response = await backfillFn({ companyId, dryRun });
            setResult(response.data);
        } catch (err) {
            console.error('Backfill error:', err);
            setError(err.message || 'Failed to run backfill');
        } finally {
            setLoading(false);
        }
    };

    const runAllBackfill = async (dryRun) => {
        setLoading(true);
        setError('');
        setResult(null);

        try {
            // Set 9-minute timeout for processing all companies
            const backfillFn = httpsCallable(functions, 'backfillAllStats', {
                timeout: 540000 // 9 minutes
            });
            const response = await backfillFn({ dryRun });
            setResult(response.data);
        } catch (err) {
            console.error('Backfill All error:', err);
            setError(err.message || 'Failed to run backfill');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="mb-6">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    Performance Stats Backfill
                </h2>
                <p className="text-sm text-gray-600">
                    Rebuild stats_daily from all historical activity data. Use dry-run first to preview results.
                </p>
            </div>

            {/* Ray Star LLC Section */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="font-semibold text-gray-900 mb-3">
                    Ray Star LLC (Test Company)
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    Company ID: <code className="bg-white px-2 py-1 rounded text-xs">iHexmEEmD8ygvL6qZ5Zd</code>
                </p>
                <div className="flex gap-3">
                    <button
                        onClick={() => runBackfill('iHexmEEmD8ygvL6qZ5Zd', true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Play size={16} />
                        )}
                        Dry-Run (Preview)
                    </button>
                    <button
                        onClick={() => runBackfill('iHexmEEmD8ygvL6qZ5Zd', false)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <CheckCircle size={16} />
                        )}
                        Run Actual Backfill
                    </button>
                </div>
            </div>

            {/* All Companies Section */}
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <h3 className="font-semibold text-gray-900 mb-3">
                    All Companies
                </h3>
                <p className="text-sm text-gray-600 mb-4">
                    ⚠️ This will process all companies. Only run after verifying Ray Star LLC results.
                </p>
                <div className="flex gap-3">
                    <button
                        onClick={() => runAllBackfill(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Play size={16} />
                        )}
                        Dry-Run All
                    </button>
                    <button
                        onClick={() => runAllBackfill(false)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {loading ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <CheckCircle size={16} />
                        )}
                        Run All Companies
                    </button>
                </div>
            </div>

            {/* Results Display */}
            {error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                    <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <h4 className="font-semibold text-red-900 mb-1">Error</h4>
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                </div>
            )}

            {result && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-start gap-3 mb-4">
                        <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-semibold text-green-900 mb-1">
                                {result.dryRun ? 'Dry-Run Complete' : 'Backfill Complete'}
                            </h4>
                            <p className="text-sm text-green-700">
                                {result.dryRun
                                    ? 'Preview generated successfully. No data was modified.'
                                    : 'Stats have been written to Firestore.'}
                            </p>
                        </div>
                    </div>

                    <div className="bg-white rounded-lg p-4 space-y-2">
                        {result.companyId && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Company ID:</span>
                                <span className="font-mono text-gray-900">{result.companyId}</span>
                            </div>
                        )}
                        {result.companiesProcessed && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Companies Processed:</span>
                                <span className="font-semibold text-gray-900">{result.companiesProcessed}</span>
                            </div>
                        )}
                        {result.companiesSucceeded && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Companies Succeeded:</span>
                                <span className="font-semibold text-green-600">{result.companiesSucceeded}</span>
                            </div>
                        )}
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Total Activities Processed:</span>
                            <span className="font-semibold text-blue-600">
                                {result.totalActivitiesProcessed?.toLocaleString() || 0}
                            </span>
                        </div>
                        {result.legacyCount !== undefined && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600 pl-4">↳ Legacy (activities):</span>
                                <span className="text-gray-700">{result.legacyCount.toLocaleString()}</span>
                            </div>
                        )}
                        {result.modernCount !== undefined && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600 pl-4">↳ Modern (activity_logs):</span>
                                <span className="text-gray-700">{result.modernCount.toLocaleString()}</span>
                            </div>
                        )}
                        {result.daysWithStats && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Days with Stats:</span>
                                <span className="font-semibold text-gray-900">{result.daysWithStats}</span>
                            </div>
                        )}
                        {result.daysWritten && (
                            <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Days Written:</span>
                                <span className="font-semibold text-green-600">{result.daysWritten}</span>
                            </div>
                        )}
                    </div>

                    {/* Preview Data */}
                    {result.preview && result.preview.length > 0 && (
                        <div className="mt-4">
                            <h5 className="text-sm font-semibold text-gray-900 mb-2">
                                Preview (First {result.preview.length} Days)
                            </h5>
                            <div className="bg-white rounded-lg border border-gray-200 max-h-64 overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-700">Date</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Dials</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Connected</th>
                                            <th className="px-3 py-2 text-right text-xs font-semibold text-gray-700">Users</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {result.preview.map((day, idx) => (
                                            <tr key={idx} className="hover:bg-gray-50">
                                                <td className="px-3 py-2 font-mono text-xs">{day.dateKey}</td>
                                                <td className="px-3 py-2 text-right font-semibold">{day.totalDials}</td>
                                                <td className="px-3 py-2 text-right text-green-600">{day.connected}</td>
                                                <td className="px-3 py-2 text-right text-gray-600">{day.userCount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
