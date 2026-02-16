/**
 * CompanyQuestionsManager
 * 
 * Company Admin view for managing application questions:
 * - View global questions (read-only for DOT fields)
 * - Hide optional fields
 * - Add company-specific custom questions
 */

import React, { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { useData } from '@/context/DataContext';
import { Loader2, Eye, EyeOff, Plus, Save, Shield, Lock, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { CustomQuestionsBuilder } from './questions/CustomQuestionsBuilder';
import { INITIAL_QUESTION_STATE } from './questions/QuestionConfig';

export function CompanyQuestionsManager({ companyId }) {
    const { currentUser } = useData();
    const [globalSchema, setGlobalSchema] = useState(null);
    const [companyOverrides, setCompanyOverrides] = useState({
        hiddenFields: [],
        additionalQuestions: []
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('visibility');

    // Fetch global schema and company overrides
    useEffect(() => {
        async function fetchData() {
            setLoading(true);
            try {
                // Fetch global schema
                const globalRef = doc(db, 'system_settings', 'application_schema');
                const globalSnap = await getDoc(globalRef);
                if (globalSnap.exists()) {
                    setGlobalSchema(globalSnap.data());
                }

                // Fetch company overrides
                if (companyId) {
                    const companyRef = doc(db, 'companies', companyId, 'settings', 'custom_questions');
                    const companySnap = await getDoc(companyRef);
                    if (companySnap.exists()) {
                        setCompanyOverrides(companySnap.data());
                    }
                }
            } catch (err) {
                console.error('[CompanyQuestionsManager] Error:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        }
        fetchData();
    }, [companyId]);

    // Flatten global fields
    const globalFields = useMemo(() => {
        if (!globalSchema?.sections) return [];
        return globalSchema.sections.flatMap(section =>
            (section.fields || []).map(field => ({
                ...field,
                sectionTitle: section.title,
                stepNumber: section.stepNumber
            }))
        );
    }, [globalSchema]);

    // Toggle field visibility
    const toggleFieldVisibility = (fieldKey) => {
        const hiddenFields = new Set(companyOverrides.hiddenFields || []);
        if (hiddenFields.has(fieldKey)) {
            hiddenFields.delete(fieldKey);
        } else {
            hiddenFields.add(fieldKey);
        }
        setCompanyOverrides(prev => ({
            ...prev,
            hiddenFields: Array.from(hiddenFields)
        }));
        setSaveSuccess(false);
    };

    // Handle custom questions change
    const handleCustomQuestionsChange = (questions) => {
        setCompanyOverrides(prev => ({
            ...prev,
            additionalQuestions: questions
        }));
        setSaveSuccess(false);
    };

    // Save to Firestore
    const handleSave = async () => {
        if (!companyId) return;
        setSaving(true);

        try {
            const companyRef = doc(db, 'companies', companyId, 'settings', 'custom_questions');
            await setDoc(companyRef, {
                ...companyOverrides,
                updatedAt: serverTimestamp(),
                updatedBy: currentUser?.uid || 'unknown'
            });
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err) {
            console.error('[CompanyQuestionsManager] Save error:', err);
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-blue-600" size={32} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
                <AlertCircle className="inline mr-2" size={18} />
                {error}
            </div>
        );
    }

    const hiddenSet = new Set(companyOverrides.hiddenFields || []);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-gray-900">Application Questions</h2>
                    <p className="text-sm text-gray-500">Customize which questions appear on your driver application</p>
                </div>
                <div className="flex items-center gap-3">
                    {saveSuccess && (
                        <span className="flex items-center gap-1 text-green-600 text-sm">
                            <CheckCircle size={16} /> Saved!
                        </span>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                        {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                        Save Changes
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="flex gap-4">
                    <button
                        onClick={() => setActiveTab('visibility')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'visibility'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Field Visibility
                    </button>
                    <button
                        onClick={() => setActiveTab('custom')}
                        className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${activeTab === 'custom'
                                ? 'border-blue-600 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        Custom Questions ({companyOverrides.additionalQuestions?.length || 0})
                    </button>
                </nav>
            </div>

            {/* Field Visibility Tab */}
            {activeTab === 'visibility' && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                                <Shield size={12} className="text-amber-600" /> DOT Required (cannot hide)
                            </span>
                            <span className="flex items-center gap-1">
                                <Lock size={12} className="text-gray-400" /> Locked by Admin
                            </span>
                        </div>
                    </div>

                    <div className="divide-y divide-gray-100">
                        {globalFields.map(field => {
                            const isHidden = hiddenSet.has(field.key);
                            const canHide = field.canCompanyHide && !field.dotRequired;

                            return (
                                <div
                                    key={field.key}
                                    className={`p-4 flex items-center justify-between ${isHidden ? 'bg-gray-50' : ''}`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${field.dotRequired ? 'bg-amber-500' : 'bg-gray-300'}`} />
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className={`font-medium ${isHidden ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
                                                    {field.label}
                                                </span>
                                                {field.required && <span className="text-red-500 text-xs">*</span>}
                                                {field.dotRequired && (
                                                    <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                                                        DOT
                                                    </span>
                                                )}
                                            </div>
                                            <span className="text-xs text-gray-400">
                                                Step {field.stepNumber} • {field.sectionTitle}
                                            </span>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => toggleFieldVisibility(field.key)}
                                        disabled={!canHide}
                                        className={`p-2 rounded-lg transition-colors ${canHide
                                                ? isHidden
                                                    ? 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                                                    : 'text-green-600 hover:text-green-700 hover:bg-green-50'
                                                : 'text-gray-300 cursor-not-allowed'
                                            }`}
                                        title={canHide ? (isHidden ? 'Show field' : 'Hide field') : 'Cannot hide this field'}
                                    >
                                        {isHidden ? <EyeOff size={18} /> : <Eye size={18} />}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Custom Questions Tab */}
            {activeTab === 'custom' && (
                <CustomQuestionsBuilder
                    questions={companyOverrides.additionalQuestions || []}
                    onChange={handleCustomQuestionsChange}
                    onSave={handleSave}
                    loading={saving}
                />
            )}
        </div>
    );
}

export default CompanyQuestionsManager;
