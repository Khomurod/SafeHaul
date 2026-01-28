import React, { useState, useEffect } from 'react';
import { Save, AlertTriangle, Activity, Settings } from 'lucide-react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

export function DistributionControl() {
    const [settings, setSettings] = useState({
        quota_paid: 200,
        quota_free: 50,
        maintenance_mode: false
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    // Real-time listener for settings
    useEffect(() => {
        const unsub = onSnapshot(doc(db, "system_settings", "distribution"), (doc) => {
            if (doc.exists()) {
                setSettings(doc.data());
            }
        });
        return () => unsub();
    }, []);

    const handleSave = async () => {
        setLoading(true);
        try {
            // Use setDoc with { merge: true } - creates document if missing, updates if exists
            await setDoc(doc(db, "system_settings", "distribution"), {
                quota_paid: Number(settings.quota_paid),
                quota_free: Number(settings.quota_free),
                maintenance_mode: settings.maintenance_mode
            }, { merge: true });
            setMessage({ type: 'success', text: 'Configuration updated successfully.' });
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Failed to update settings.' });
        }
        setLoading(false);

        // Clear message after 3 seconds
        setTimeout(() => setMessage(null), 3000);
    };

    return (
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <Settings className="text-gray-500" size={20} />
                    Distribution Logic
                </h3>
                {settings.maintenance_mode && (
                    <span className="px-3 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full flex items-center gap-1">
                        <AlertTriangle size={12} /> MAINTENANCE MODE
                    </span>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Paid Plan Quota */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Paid Plan Quota</label>
                    <input
                        type="number"
                        value={settings.quota_paid}
                        onChange={(e) => setSettings({ ...settings, quota_paid: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leads per day for Paid companies</p>
                </div>

                {/* Free Plan Quota */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Free Plan Quota</label>
                    <input
                        type="number"
                        value={settings.quota_free}
                        onChange={(e) => setSettings({ ...settings, quota_free: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Leads per day for Free companies</p>
                </div>
            </div>

            {/* Maintenance Toggle */}
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                    <span className="font-semibold text-gray-800">Maintenance Mode</span>
                    <p className="text-xs text-gray-500">Pause all distribution immediately.</p>
                </div>
                <button
                    onClick={() => setSettings({ ...settings, maintenance_mode: !settings.maintenance_mode })}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settings.maintenance_mode ? 'bg-red-600' : 'bg-gray-300'
                        }`}
                >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settings.maintenance_mode ? 'translate-x-6' : 'translate-x-1'
                        }`} />
                </button>
            </div>

            {/* Save Button */}
            <button
                onClick={handleSave}
                disabled={loading}
                className="w-full py-2 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
            >
                {loading ? <Activity className="animate-spin" size={18} /> : <Save size={18} />}
                Update System Configuration
            </button>

            {/* Feedback Message */}
            {message && (
                <div className={`text-center text-sm font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-600'
                    }`}>
                    {message.text}
                </div>
            )}
        </div>
    );
}
