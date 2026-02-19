/**
 * GlobalQuestionsManager
 * 
 * Super Admin view for managing global application questions.
 * Connects CustomQuestionsBuilder to Firestore via useGlobalSchema hook.
 */

import React, { useMemo, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { CustomQuestionsBuilder } from '@/features/settings/components/questions/CustomQuestionsBuilder';
import { useGlobalSchema } from '@/hooks/useGlobalSchema';

export function GlobalQuestionsManager() {
    const {
        schema,
        loading,
        error,
        saving,
        saveSchema,
        refetch
    } = useGlobalSchema();

    const [saveSuccess, setSaveSuccess] = useState(false);
    const [localQuestions, setLocalQuestions] = useState(null);

    // Convert schema sections to flat question list for the builder
    const questions = useMemo(() => {
        if (localQuestions !== null) return localQuestions;
        if (!schema?.sections) return [];

        return schema.sections.flatMap((section, sectionIndex) =>
            (section.fields || []).map((field, fieldIndex) => ({
                ...field,
                id: field.key,
                sectionId: section.id,
                sectionTitle: section.title,
                stepNumber: section.stepNumber,
                order: sectionIndex * 100 + fieldIndex
            }))
        );
    }, [schema, localQuestions]);

    // Handle question changes (local state)
    const handleQuestionsChange = (updatedQuestions) => {
        setLocalQuestions(updatedQuestions);
        setSaveSuccess(false);
    };

    // Save to Firestore
    const handleSave = async () => {
        if (!schema) return;

        // Rebuild sections from flat question list
        const sectionMap = new Map();

        for (const q of localQuestions || questions) {
            const sectionId = q.sectionId || 'custom';
            if (!sectionMap.has(sectionId)) {
                // Find original section or create new
                const originalSection = schema.sections.find(s => s.id === sectionId);
                sectionMap.set(sectionId, {
                    id: sectionId,
                    title: originalSection?.title || q.sectionTitle || 'Custom Questions',
                    stepNumber: originalSection?.stepNumber || q.stepNumber || 8,
                    order: originalSection?.order || 99,
                    fields: []
                });
            }

            // Clean question object for storage
            const { sectionId: _, sectionTitle: __, order: ___, ...fieldData } = q;
            sectionMap.get(sectionId).fields.push(fieldData);
        }

        const updatedSchema = {
            ...schema,
            sections: Array.from(sectionMap.values())
        };

        const result = await saveSchema(updatedSchema);

        if (result.success) {
            setSaveSuccess(true);
            setLocalQuestions(null);
            setTimeout(() => setSaveSuccess(false), 3000);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="animate-spin text-blue-600" size={40} />
                <span className="ml-3 text-gray-600">Loading global schema...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                <AlertCircle className="mx-auto text-red-500 mb-3" size={40} />
                <h3 className="text-lg font-bold text-red-700">Failed to load schema</h3>
                <p className="text-red-600 text-sm mb-4">{error}</p>
                <button
                    onClick={refetch}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                    <RefreshCw size={16} /> Retry
                </button>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Global Application Questions</h1>
                        <p className="text-gray-500">
                            Define the standard questions asked to all drivers.
                            {schema?.version && (
                                <span className="ml-2 text-xs bg-gray-100 px-2 py-0.5 rounded">
                                    v{schema.version}
                                </span>
                            )}
                        </p>
                    </div>
                    {saveSuccess && (
                        <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-lg">
                            <CheckCircle size={18} />
                            <span className="font-medium">Saved successfully!</span>
                        </div>
                    )}
                </div>

                {/* Legend */}
                <div className="mt-4 flex flex-wrap gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 px-2 py-1 rounded">
                        🛡️ DOT Required = FMCSA mandated
                    </span>
                    <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        🔒 Locked = Companies cannot hide
                    </span>
                    <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-600 px-2 py-1 rounded">
                        📝 Editable = Label can be customized
                    </span>
                </div>
            </div>

            {/* Form Builder */}
            <CustomQuestionsBuilder
                questions={questions}
                onChange={handleQuestionsChange}
                onSave={handleSave}
                loading={saving}
            />
        </div>
    );
}

export default GlobalQuestionsManager;
